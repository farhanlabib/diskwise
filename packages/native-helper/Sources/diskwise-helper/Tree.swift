import Darwin
import Foundation

// Native `tree <path>`: one physical, single-device walk of a path that reports
// both the allocated bytes (`st_blocks * 512`, what the Node walker computes) and
// the clone-aware private bytes (`ATTR_CMNEXT_PRIVATESIZE`). APFS clones share
// extents, so the allocated sum over-reports what deleting the tree would free;
// the private sum is the number that actually gets reclaimed.

private let ftsPhysical: Int32 = 0x010
private let ftsXdev: Int32 = 0x040
private let ftsNochdir: Int32 = 0x004
private let ftsSkip: Int32 = 4

private let ftsD: Int32 = 1
private let ftsDefault: Int32 = 3
private let ftsDnr: Int32 = 4
private let ftsDp: Int32 = 6
private let ftsErr: Int32 = 7
private let ftsF: Int32 = 8
private let ftsNs: Int32 = 10
private let ftsSl: Int32 = 12
private let ftsSlnone: Int32 = 13
private let ftsW: Int32 = 14

private let maxUnreadable = 200

private struct FileKey: Hashable {
    let dev: Int32
    let ino: UInt64
}

// Only EPERM/EACCES are recorded: those are the cases the Node walker surfaces to
// the user. A vanished entry (ENOENT) is not an error, matching the walker.
private func errnoName(_ code: Int32) -> String? {
    switch code {
    case EPERM: return "EPERM"
    case EACCES: return "EACCES"
    default: return nil
    }
}

func cmdTree(_ args: [String]) throws {
    var target: String?
    var skips: [String] = []
    var maxEntries: Int?
    var index = 0
    while index < args.count {
        let arg = args[index]
        switch arg {
        case "--skip":
            guard index + 1 < args.count else {
                throw CliError(message: "tree: --skip requires a path")
            }
            skips.append(expandPath(args[index + 1]))
            index += 2
        case "--max-entries":
            guard index + 1 < args.count, let parsed = Int(args[index + 1]), parsed >= 0 else {
                throw CliError(message: "tree: --max-entries requires a non-negative integer")
            }
            maxEntries = parsed
            index += 2
        default:
            if target == nil {
                target = arg
                index += 1
            } else {
                throw CliError(message: "tree: unexpected argument '\(arg)'")
            }
        }
    }
    guard let rawTarget = target else {
        throw CliError(message: "tree: missing <path>")
    }
    let root = expandPath(rawTarget)

    var allocated: UInt64 = 0
    var privateTotal: UInt64 = 0
    var entries = 0
    var unreadable: [[String: Any]] = []
    var truncated = false
    var supported = false
    var seen = Set<FileKey>()
    var rootDev: Int32?

    func isSkipped(_ path: String) -> Bool {
        for skip in skips where path == skip || path.hasPrefix(skip + "/") {
            return true
        }
        return false
    }

    func recordUnreadable(_ path: String, _ code: Int32) {
        guard unreadable.count < maxUnreadable, let name = errnoName(code) else { return }
        unreadable.append(["path": path, "code": name])
    }

    // Dedupe by identity so a hardlink (or any repeated inode) is counted once,
    // exactly as the Node walker's shared `seen` set does.
    func countEntry(_ statp: UnsafeMutablePointer<stat>, _ path: String, regularFile: Bool) {
        let key = FileKey(dev: statp.pointee.st_dev, ino: statp.pointee.st_ino)
        if !seen.insert(key).inserted { return }
        let bytes = UInt64(max(0, statp.pointee.st_blocks)) * 512
        allocated += bytes
        entries += 1
        if regularFile, let priv = privateSize(ofPath: path) {
            supported = true
            privateTotal += priv
        } else {
            privateTotal += bytes
        }
    }

    let rootC = strdup(root)
    defer { free(rootC) }
    var pathv: [UnsafeMutablePointer<CChar>?] = [rootC, nil]
    guard let fts = fts_open(&pathv, ftsPhysical | ftsXdev | ftsNochdir, nil) else {
        throw CliError(message: "tree: could not open \(root)")
    }
    defer { fts_close(fts) }

    while let node = fts_read(fts) {
        let info = Int32(node.pointee.fts_info)
        let rawPath = String(cString: node.pointee.fts_path)

        if info == ftsDp { continue }

        guard let statp = node.pointee.fts_statp else {
            if info == ftsErr { recordUnreadable(rawPath, node.pointee.fts_errno) }
            continue
        }
        if info == ftsErr || info == ftsNs {
            if info == ftsErr { recordUnreadable(rawPath, node.pointee.fts_errno) }
            continue
        }
        if let limit = maxEntries, entries >= limit {
            truncated = true
            break
        }

        switch info {
        case ftsD:
            // A skipped subtree is not counted at all, matching the walker.
            if isSkipped(rawPath) {
                fts_set(fts, node, ftsSkip)
                continue
            }
            if rootDev == nil { rootDev = statp.pointee.st_dev }
            if statp.pointee.st_dev != rootDev! {
                fts_set(fts, node, ftsSkip)
                continue
            }
            countEntry(statp, rawPath, regularFile: false)
        case ftsF:
            countEntry(statp, rawPath, regularFile: true)
        case ftsSl, ftsSlnone, ftsDefault, ftsW:
            countEntry(statp, rawPath, regularFile: false)
        case ftsDnr:
            recordUnreadable(rawPath, node.pointee.fts_errno)
            countEntry(statp, rawPath, regularFile: false)
        default:
            break
        }
    }

    ok([
        "path": root,
        "allocated": allocated,
        "privateSize": privateTotal,
        "entries": entries,
        "unreadable": unreadable,
        "truncated": truncated,
        "privateSizeSupported": supported,
    ])
}
