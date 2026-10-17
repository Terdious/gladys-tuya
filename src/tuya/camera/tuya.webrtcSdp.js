// -----------------------------------------------------------------------------
// SDP shaping between the browser and a Tuya camera (WebRTC live view).
//
// The Gladys dashboard sends a complete, non-trickle offer (every ICE
// candidate inlined, video then audio) and expects a complete answer. A Tuya
// camera, through its MQTT signalling, wants something else (as go2rtc and the
// tuya/webrtc-demo-go client do):
//   - the audio section FIRST, otherwise the camera answers a corrupt SDP;
//   - a short offer: the camera only accepts an 8 KB JSON message, so the
//     header extensions and the codecs it cannot play are removed (video:
//     H264 only; audio: PCMA / PCMU);
//   - the ICE candidates trickled as separate MQTT messages, and its own
//     candidates trickled back after its answer.
// The answer is then put back in the browser's section order with the
// camera's candidates inlined.
// -----------------------------------------------------------------------------

const CRLF = '\r\n';

const VIDEO_CODECS = new Set(['h264']);
const AUDIO_CODECS = new Set(['pcma', 'pcmu']);

/**
 * @description Split an SDP into its session part and its media sections.
 * @param {string} sdp - The SDP.
 * @returns {{ session: Array<string>, media: Array<Array<string>> }} The lines.
 * @example
 * const { session, media } = splitSdp(offer);
 */
export const splitSdp = (sdp) => {
  const lines = String(sdp || '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const session = [];
  const media = [];
  lines.forEach((line) => {
    if (line.startsWith('m=')) {
      media.push([line]);
    } else if (media.length === 0) {
      session.push(line);
    } else {
      media[media.length - 1].push(line);
    }
  });
  return { session, media };
};

const joinSdp = (session, media) => `${[...session, ...media.flat()].join(CRLF)}${CRLF}`;

export const getKind = (section) => section[0].slice(2).split(' ')[0];

export const getMid = (section) => {
  const line = section.find((l) => l.startsWith('a=mid:'));
  return line ? line.slice('a=mid:'.length).trim() : null;
};

// Payload type -> lowercase codec name, from the a=rtpmap lines.
const getCodecs = (section) => {
  const codecs = {};
  section.forEach((line) => {
    const match = /^a=rtpmap:(\d+) ([^/]+)/.exec(line);
    if (match) {
      codecs[match[1]] = match[2].toLowerCase();
    }
  });
  return codecs;
};

const getFmtp = (section, payloadType) => {
  const line = section.find((l) => l.startsWith(`a=fmtp:${payloadType} `));
  return line || '';
};

// The payload types a section keeps: the codecs the camera can play; for
// H264, the packetization-mode=1 variants when there are any (the mode every
// Tuya camera streams).
const pickPayloadTypes = (section) => {
  const kind = getKind(section);
  const allowed = kind === 'video' ? VIDEO_CODECS : AUDIO_CODECS;
  const codecs = getCodecs(section);
  const offered = section[0].split(' ').slice(3);
  const kept = offered.filter((pt) => allowed.has(codecs[pt]));
  if (kind !== 'video') {
    return kept;
  }
  const modeOne = kept.filter((pt) => /packetization-mode=1/.test(getFmtp(section, pt)));
  return modeOne.length > 0 ? modeOne : kept;
};

const PAYLOAD_ATTRIBUTE = /^a=(rtpmap|fmtp|rtcp-fb):(\d+|\*)[ ]/;

const keepSectionLine = (line, keptPayloadTypes) => {
  if (line.startsWith('a=extmap:') || line.startsWith('a=candidate:')) {
    return false;
  }
  if (line === 'a=end-of-candidates') {
    return false;
  }
  const match = PAYLOAD_ATTRIBUTE.exec(line);
  if (match && match[2] !== '*') {
    return keptPayloadTypes.has(match[2]);
  }
  return true;
};

/**
 * @description Shape the browser's offer for a Tuya camera: audio first, only
 * the codecs it plays, no header extension, the candidates set apart.
 * @param {string} sdp - The browser's complete offer.
 * @returns {{ sdp: string, candidates: Array<string>, mids: Array<string|null>, sentMids: Array<string|null> }}
 * The offer to send, the browser's candidates (`candidate:...`, to trickle),
 * the browser's section order (mids) to restore in the answer, and the order
 * of the offer sent.
 * @example
 * const { sdp, candidates, mids } = shapeOfferForTuya(offer);
 */
export const shapeOfferForTuya = (sdp) => {
  const { session, media } = splitSdp(sdp);
  if (media.length === 0) {
    throw new Error('the offer has no media section');
  }
  const mids = media.map(getMid);
  const candidates = [];
  media.forEach((section) => {
    section
      .filter((line) => line.startsWith('a=candidate:'))
      .forEach((line) => {
        const candidate = line.slice(2);
        if (!candidates.includes(candidate)) {
          candidates.push(candidate);
        }
      });
  });

  const shaped = media.map((section) => {
    const kind = getKind(section);
    if (kind !== 'audio' && kind !== 'video') {
      return section.filter((line) => !line.startsWith('a=candidate:'));
    }
    const payloadTypes = pickPayloadTypes(section);
    if (payloadTypes.length === 0) {
      throw new Error(
        kind === 'video'
          ? 'the browser offers no H264 video (needed by Tuya cameras)'
          : 'the browser offers no PCMA/PCMU audio (needed by Tuya cameras)',
      );
    }
    const kept = new Set(payloadTypes);
    const mLine = section[0].split(' ').slice(0, 3).concat(payloadTypes).join(' ');
    return [mLine, ...section.slice(1).filter((line) => keepSectionLine(line, kept))];
  });

  // Audio first (a stable sort keeps the relative order of the others).
  const rank = (section) => {
    const kind = getKind(section);
    if (kind === 'audio') {
      return 0;
    }
    return kind === 'video' ? 1 : 2;
  };
  const ordered = shaped
    .map((section, index) => ({ section, index }))
    .sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index)
    .map(({ section }) => section);

  return {
    sdp: joinSdp(
      session.filter((line) => !line.startsWith('a=extmap')),
      ordered,
    ),
    candidates,
    mids,
    sentMids: ordered.map(getMid),
  };
};

/**
 * @description Normalize a candidate trickled by a Tuya camera (it sends
 * `a=candidate:...\r\n`) to `candidate:...`, or null when empty.
 * @param {string} candidate - The raw candidate.
 * @returns {string|null} The candidate.
 * @example
 * normalizeTuyaCandidate('a=candidate:1 1 udp 2113937151 1.2.3.4 5000 typ host\r\n');
 */
export const normalizeTuyaCandidate = (candidate) => {
  const value = String(candidate || '')
    .trim()
    .replace(/^a=/, '');
  return value.startsWith('candidate:') ? value : null;
};

/**
 * @description Build the complete answer the browser expects from the
 * camera's answer: sections back in the browser's order, the camera's
 * candidates inlined in each section, then end-of-candidates.
 * @param {string} answerSdp - The camera's answer.
 * @param {Array<string>} candidates - The camera's candidates (`candidate:...`).
 * @param {Array<string|null>} browserMids - The browser's section order.
 * @param {Array<string|null>} sentMids - The section order of the offer sent.
 * @returns {string} The answer for the browser.
 * @example
 * const sdp = buildBrowserAnswer(answer, candidates, ['0', '1'], ['1', '0']);
 */
export const buildBrowserAnswer = (answerSdp, candidates, browserMids, sentMids) => {
  const { session, media } = splitSdp(answerSdp);
  if (media.length === 0) {
    throw new Error('the camera answer has no media section');
  }
  // A section without a=mid is matched by its position in the offer sent.
  const byMid = new Map();
  media.forEach((section, index) => {
    byMid.set(getMid(section) ?? sentMids[index] ?? String(index), section);
  });
  const ordered = browserMids.map((mid, index) => byMid.get(mid ?? String(index)));
  if (ordered.some((section) => !section)) {
    throw new Error('the camera answer does not match the offer sections');
  }
  const withCandidates = ordered.map((section) => {
    const lines = section.filter(
      (line) => !line.startsWith('a=candidate:') && line !== 'a=end-of-candidates',
    );
    const own = section.filter((line) => line.startsWith('a=candidate:')).map((l) => l.slice(2));
    const all = [...own, ...candidates.filter((c) => !own.includes(c))];
    return [...lines, ...all.map((c) => `a=${c}`), 'a=end-of-candidates'];
  });
  return joinSdp(session, withCandidates);
};
