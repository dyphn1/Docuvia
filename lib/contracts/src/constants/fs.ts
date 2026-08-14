/**
 * Plain string constants shared across layers for file system operations, lockfile flags,
 * Node.js system error codes, and platform strings.
 */

/** Node.js `fs.open` flag: fail (`EEXIST`) instead of overwriting if the path already exists — exclusive create mode. */
export const FS_FLAG_EXCLUSIVE_CREATE_WRITE = "wx" as const;

/** System error code reported by Node.js `fs.open(path, "wx")` when `path` already exists. */
export const ERRNO_EEXIST = "EEXIST" as const;

/** System error code reported by Node.js operations when permission is denied or a resource is locked. */
export const ERRNO_EPERM = "EPERM" as const;

/** System error code reported by Node.js operations when file access is forbidden. */
export const ERRNO_EACCES = "EACCES" as const;

/** System error code reported by Node.js operations when a resource/device is busy. */
export const ERRNO_EBUSY = "EBUSY" as const;

/** Node.js `process.platform` value for Windows operating systems. */
export const PLATFORM_WIN32 = "win32" as const;
