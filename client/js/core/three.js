/**
 * Single import point for Three.js.
 *
 * The library is vendored in client/vendor/ rather than pulled from a CDN, because
 * the whole project has to work on a LAN with no internet connection at all.
 * Everything else in the client imports THREE from here.
 */
export * from '../../vendor/three.module.js';
