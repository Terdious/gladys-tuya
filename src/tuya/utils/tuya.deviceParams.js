// Ported from server/services/tuya/lib/utils/tuya.deviceParams.js.
//
// Only the pure param helpers are ported: the discovered-device merge helpers
// of the core (stateManager / mergeDevices based) are not needed here, the
// core upserts discovered devices by external_id itself.

export const upsertParam = (params, name, value) => {
  if (value === undefined || value === null) {
    return;
  }
  const index = params.findIndex((param) => param.name === name);
  if (index >= 0) {
    params[index] = { ...params[index], value };
  } else {
    params.push({ name, value });
  }
};

export const getParamValue = (params, name) => {
  if (!Array.isArray(params)) {
    return undefined;
  }
  const found = params.find((param) => param.name === name);
  return found ? found.value : undefined;
};
