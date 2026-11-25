/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { CORE_URL, FFMessageType } from "./const.js";
import { ERROR_UNKNOWN_MESSAGE_TYPE, ERROR_NOT_LOADED, ERROR_IMPORT_FAILURE, } from "./errors.js";
let ffmpeg;
const activeOpfsMounts = new Map();
let opfsScratch = new Uint8Array(262144);
const ensureOpfsScratch = (length) => {
    if (opfsScratch.byteLength < length) {
        opfsScratch = new Uint8Array(length);
    }
    return opfsScratch;
};
const createOpfsFilesystem = () => {
    const DIR_MODE = 16895;
    const FILE_MODE = 33279;
    const opfsFs = {
        mount(mount) {
            const root = opfsFs.createNode(null, "/", DIR_MODE, null);
            for (const [name, handle] of Object.entries(mount.opts.handles || {})) {
                opfsFs.createNode(root, name, FILE_MODE, handle);
            }
            return root;
        },
        createNode(parent, name, mode, handle) {
            const node = ffmpeg.FS.createNode(parent, name, mode);
            node.mode = mode;
            node.node_ops = opfsFs.node_ops;
            node.stream_ops = opfsFs.stream_ops;
            node.timestamp = Date.now();
            node.contents = mode === FILE_MODE ? handle : {};
            if (parent) {
                parent.contents[name] = node;
            }
            return node;
        },
        node_ops: {
            getattr(node) {
                const size = ffmpeg.FS.isFile(node.mode) ? node.contents.getSize() : 4096;
                const time = new Date(node.timestamp);
                return {
                    dev: 1,
                    ino: node.id,
                    mode: node.mode,
                    nlink: 1,
                    uid: 0,
                    gid: 0,
                    rdev: undefined,
                    size,
                    atime: time,
                    mtime: time,
                    ctime: time,
                    blksize: 4096,
                    blocks: Math.ceil(size / 4096),
                };
            },
            setattr(node, attr) {
                if (attr.mode !== undefined) {
                    node.mode = attr.mode;
                }
                if (attr.timestamp !== undefined) {
                    node.timestamp = attr.timestamp;
                }
                if (attr.size !== undefined && ffmpeg.FS.isFile(node.mode)) {
                    node.contents.truncate(attr.size);
                    node.timestamp = Date.now();
                }
            },
            lookup(parent, name) {
                if (parent.contents && Object.prototype.hasOwnProperty.call(parent.contents, name)) {
                    return parent.contents[name];
                }
                throw new ffmpeg.FS.ErrnoError(44);
            },
            mknod() {
                throw new ffmpeg.FS.ErrnoError(63);
            },
            rename() {
                throw new ffmpeg.FS.ErrnoError(63);
            },
            unlink() {
                throw new ffmpeg.FS.ErrnoError(63);
            },
            rmdir() {
                throw new ffmpeg.FS.ErrnoError(63);
            },
            readdir(node) {
                const entries = [".", ".."];
                for (const key in node.contents) {
                    if (Object.prototype.hasOwnProperty.call(node.contents, key)) {
                        entries.push(key);
                    }
                }
                return entries;
            },
            symlink() {
                throw new ffmpeg.FS.ErrnoError(63);
            },
        },
        stream_ops: {
            read(stream, buffer, offset, length, position) {
                if (!length) {
                    return 0;
                }
                const scratch = ensureOpfsScratch(length);
                const bytesRead = stream.node.contents.read(scratch.subarray(0, length), { at: position });
                if (bytesRead > 0) {
                    const dest = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, bytesRead);
                    dest.set(scratch.subarray(0, bytesRead));
                }
                return bytesRead;
            },
            write(stream, buffer, offset, length, position) {
                if (!length) {
                    return 0;
                }
                const scratch = ensureOpfsScratch(length);
                const slice = scratch.subarray(0, length);
                const source = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length);
                slice.set(source);
                stream.node.timestamp = Date.now();
                return stream.node.contents.write(slice, { at: position });
            },
            llseek(stream, offset, whence) {
                let position = offset;
                if (whence === 1) {
                    position += stream.position;
                }
                else if (whence === 2 && ffmpeg.FS.isFile(stream.node.mode)) {
                    position += stream.node.contents.getSize();
                }
                if (position < 0) {
                    throw new ffmpeg.FS.ErrnoError(28);
                }
                return position;
            },
        },
    };
    return opfsFs;
};
const closeHandles = (handles) => {
    for (const handle of Object.values(handles)) {
        try {
            handle.flush();
        }
        catch {
            // Ignore flush errors on read-only or closed handles.
        }
        try {
            handle.close();
        }
        catch {
            // Ignore already-closed handles.
        }
    }
};
const mountOpfs = async ({ jobDir, readOnlyFiles = [], readWriteFiles = [], mountPoint = "/opfs" }) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(jobDir);
    const handles = {};
    try {
        for (const name of readOnlyFiles) {
            const fileHandle = await dir.getFileHandle(name);
            handles[name] = await fileHandle.createSyncAccessHandle();
        }
        for (const name of readWriteFiles) {
            const fileHandle = await dir.getFileHandle(name, { create: true });
            const handle = await fileHandle.createSyncAccessHandle();
            handle.truncate(0);
            handles[name] = handle;
        }
        try {
            ffmpeg.FS.mkdir(mountPoint);
        }
        catch {
            // Mount directory already exists.
        }
        ffmpeg.FS.mount(createOpfsFilesystem(), { handles }, mountPoint);
        activeOpfsMounts.set(mountPoint, handles);
        return true;
    }
    catch (error) {
        closeHandles(handles);
        throw error;
    }
};
const unmountOpfs = ({ mountPoint = "/opfs" }) => {
    const handles = activeOpfsMounts.get(mountPoint);
    try {
        ffmpeg.FS.unmount(mountPoint);
    }
    catch {
        // Ignore if already unmounted.
    }
    if (handles) {
        closeHandles(handles);
        activeOpfsMounts.delete(mountPoint);
    }
    return true;
};
const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL, }) => {
    const first = !ffmpeg;
    try {
        if (!_coreURL)
            _coreURL = CORE_URL;
        // when web worker type is `classic`.
        importScripts(_coreURL);
    }
    catch {
        if (!_coreURL || _coreURL === CORE_URL)
            _coreURL = CORE_URL.replace('/umd/', '/esm/');
        // when web worker type is `module`.
        self.createFFmpegCore = (await import(
        /* @vite-ignore */ _coreURL)).default;
        if (!self.createFFmpegCore) {
            throw ERROR_IMPORT_FAILURE;
        }
    }
    const coreURL = _coreURL;
    const wasmURL = _wasmURL ? _wasmURL : _coreURL.replace(/.js$/g, ".wasm");
    const workerURL = _workerURL
        ? _workerURL
        : _coreURL.replace(/.js$/g, ".worker.js");
    ffmpeg = await self.createFFmpegCore({
        // Fix `Overload resolution failed.` when using multi-threaded ffmpeg-core.
        // Encoded wasmURL and workerURL in the URL as a hack to fix locateFile issue.
        mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
    });
    ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
    ffmpeg.setProgress((data) => self.postMessage({
        type: FFMessageType.PROGRESS,
        data,
    }));
    return first;
};
const exec = ({ args, timeout = -1 }) => {
    ffmpeg.setTimeout(timeout);
    ffmpeg.exec(...args);
    const ret = ffmpeg.ret;
    ffmpeg.reset();
    return ret;
};
const ffprobe = ({ args, timeout = -1 }) => {
    ffmpeg.setTimeout(timeout);
    ffmpeg.ffprobe(...args);
    const ret = ffmpeg.ret;
    ffmpeg.reset();
    return ret;
};
const writeFile = ({ path, data }) => {
    ffmpeg.FS.writeFile(path, data, data instanceof Uint8Array ? { canOwn: true } : undefined);
    return true;
};
const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });
const takeFile = ({ path }) => {
    const lookup = ffmpeg.FS.lookupPath(path);
    const node = lookup?.node;
    if (node?.contents instanceof Uint8Array && typeof node.usedBytes === "number") {
        const used = node.usedBytes;
        const raw = node.contents;
        const result = raw.byteOffset === 0 && raw.byteLength === used ? raw : raw.slice(0, used);
        node.contents = null;
        node.usedBytes = 0;
        try {
            ffmpeg.FS.unlink(path);
        }
        catch {
            // Ignore unlink failure after clearing node storage.
        }
        return result;
    }
    const data = ffmpeg.FS.readFile(path, { encoding: "binary" });
    try {
        ffmpeg.FS.unlink(path);
    }
    catch {
        // Ignore unlink failure.
    }
    return data;
};
// TODO: check if deletion works.
const deleteFile = ({ path }) => {
    ffmpeg.FS.unlink(path);
    return true;
};
const rename = ({ oldPath, newPath }) => {
    ffmpeg.FS.rename(oldPath, newPath);
    return true;
};
// TODO: check if creation works.
const createDir = ({ path }) => {
    ffmpeg.FS.mkdir(path);
    return true;
};
const listDir = ({ path }) => {
    const names = ffmpeg.FS.readdir(path);
    const nodes = [];
    for (const name of names) {
        const stat = ffmpeg.FS.stat(`${path}/${name}`);
        const isDir = ffmpeg.FS.isDir(stat.mode);
        nodes.push({ name, isDir });
    }
    return nodes;
};
// TODO: check if deletion works.
const deleteDir = ({ path }) => {
    ffmpeg.FS.rmdir(path);
    return true;
};
const mount = ({ fsType, options, mountPoint }) => {
    const str = fsType;
    const fs = ffmpeg.FS.filesystems[str];
    if (!fs)
        return false;
    ffmpeg.FS.mount(fs, options, mountPoint);
    return true;
};
const unmount = ({ mountPoint }) => {
    ffmpeg.FS.unmount(mountPoint);
    return true;
};
self.onmessage = async ({ data: { id, type, data: _data }, }) => {
    const trans = [];
    let data;
    try {
        if (type !== FFMessageType.LOAD && !ffmpeg)
            throw ERROR_NOT_LOADED; // eslint-disable-line
        switch (type) {
            case FFMessageType.LOAD:
                data = await load(_data);
                break;
            case FFMessageType.EXEC:
                data = exec(_data);
                break;
            case FFMessageType.FFPROBE:
                data = ffprobe(_data);
                break;
            case FFMessageType.WRITE_FILE:
                data = writeFile(_data);
                break;
            case FFMessageType.READ_FILE:
                data = readFile(_data);
                break;
            case FFMessageType.TAKE_FILE:
                data = takeFile(_data);
                break;
            case FFMessageType.DELETE_FILE:
                data = deleteFile(_data);
                break;
            case FFMessageType.RENAME:
                data = rename(_data);
                break;
            case FFMessageType.CREATE_DIR:
                data = createDir(_data);
                break;
            case FFMessageType.LIST_DIR:
                data = listDir(_data);
                break;
            case FFMessageType.DELETE_DIR:
                data = deleteDir(_data);
                break;
            case FFMessageType.MOUNT:
                data = mount(_data);
                break;
            case FFMessageType.UNMOUNT:
                data = unmount(_data);
                break;
            case FFMessageType.MOUNT_OPFS:
                data = await mountOpfs(_data);
                break;
            case FFMessageType.UNMOUNT_OPFS:
                data = unmountOpfs(_data);
                break;
            default:
                throw ERROR_UNKNOWN_MESSAGE_TYPE;
        }
    }
    catch (e) {
        self.postMessage({
            id,
            type: FFMessageType.ERROR,
            data: e.toString(),
        });
        return;
    }
    if (data instanceof Uint8Array) {
        trans.push(data.buffer);
    }
    self.postMessage({ id, type, data }, trans);
};
