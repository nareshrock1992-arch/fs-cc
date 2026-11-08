/**
 * phoneSingleton — exactly one PhoneService per page (Phase 2 plan R-2, engine finding E-2).
 *
 * The engine constructor adds window listeners and has no dispose(), and React StrictMode
 * mounts effects twice, so React components must never construct it. They call
 * getPhoneService() instead, which builds the instance lazily on first use.
 */
import { PhoneService } from './engine/src/services/phone-service';

let instance = null;
let instanceConfig = null;

/**
 * @param {object} config engine AppConfig (from configAdapter.buildAppConfig)
 * @returns {PhoneService}
 */
export function getPhoneService(config) {
  if (!instance) {
    if (!config) throw new Error('getPhoneService: configuration is required on first use.');
    instance = new PhoneService(config);
    instanceConfig = config;
  }
  return instance;
}

/** The config the singleton was created with (null before first use). */
export function getPhoneServiceConfig() {
  return instanceConfig;
}

/** Test-only: forget the instance. Not exported from index.js. */
export function __resetPhoneServiceForTests() {
  instance = null;
  instanceConfig = null;
}
