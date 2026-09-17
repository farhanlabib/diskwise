import AppKit
import Darwin
import Foundation

func cmdTrash(_ args: [String]) throws {
    guard let raw = args.first else {
        throw CliError(message: "trash: missing <path>")
    }
    if args.count > 1 {
        throw CliError(message: "trash: unexpected argument '\(args[1])'")
    }
    let path = expandPath(raw)
    var resulting: NSURL?
    do {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: &resulting)
    } catch {
        throw CliError(message: "trash failed for \(path): \(error.localizedDescription)")
    }
    ok(["path": path, "trashedPath": resulting?.path ?? ""])
}

func cmdRunningApps(_ args: [String]) throws {
    if !args.isEmpty {
        throw CliError(message: "running-apps: unexpected argument '\(args[0])'")
    }
    let apps: [[String: Any]] = NSWorkspace.shared.runningApplications.compactMap { app in
        guard let bundleId = app.bundleIdentifier else { return nil }
        return [
            "bundleId": bundleId,
            "name": app.localizedName ?? "",
            "pid": Int(app.processIdentifier),
            "bundlePath": app.bundleURL?.path ?? "",
        ]
    }
    ok(["apps": apps])
}

func cmdQuitApp(_ args: [String]) throws {
    var bundleId: String?
    var timeoutSec: Double = 10
    var index = 0
    while index < args.count {
        let arg = args[index]
        if arg == "--timeout" {
            guard index + 1 < args.count, let parsed = Double(args[index + 1]), parsed >= 0 else {
                throw CliError(message: "quit-app: --timeout requires a non-negative number of seconds")
            }
            timeoutSec = parsed
            index += 2
        } else if bundleId == nil {
            bundleId = arg
            index += 1
        } else {
            throw CliError(message: "quit-app: unexpected argument '\(arg)'")
        }
    }
    guard let target = bundleId else {
        throw CliError(message: "quit-app: missing <bundleId>")
    }

    let matches = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == target }
    if matches.isEmpty {
        ok(["quit": true, "stillRunning": 0])
    }

    // Polite shutdown only: terminate() posts a Quit Apple event. forceTerminate()
    // is never called, so an app showing a save prompt is simply left running.
    for app in matches {
        app.terminate()
    }

    // Poll by pumping the run loop rather than sleeping on the thread: NSWorkspace
    // learns that an app died through notifications delivered on the main run loop,
    // so a bare Thread.sleep would leave isTerminated false forever.
    let deadline = Date().addingTimeInterval(timeoutSec)
    while Date() < deadline {
        if matches.allSatisfy({ $0.isTerminated }) { break }
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.2))
    }

    let stillRunning = matches.filter { !$0.isTerminated }.count
    if stillRunning == 0 {
        ok(["quit": true, "stillRunning": 0])
    } else {
        fail(
            ["quit": false, "stillRunning": stillRunning],
            message: "\(stillRunning) instance(s) of \(target) still running after \(timeoutSec)s"
        )
    }
}

func cmdPrivateSize(_ args: [String]) throws {
    guard !args.isEmpty else {
        throw CliError(message: "privatesize: missing <path>...")
    }
    var items: [[String: Any]] = []
    var supported = false
    for raw in args {
        let path = expandPath(raw)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else {
            items.append(["path": path, "allocated": 0, "note": "missing"])
            continue
        }
        if isDirectory.boolValue {
            items.append(["path": path, "allocated": 0, "note": "directory"])
            continue
        }

        var allocated = 0
        if let values = try? URL(fileURLWithPath: path).resourceValues(
            forKeys: [.totalFileAllocatedSizeKey, .fileAllocatedSizeKey]
        ) {
            allocated = values.totalFileAllocatedSize ?? values.fileAllocatedSize ?? 0
        }

        var item: [String: Any] = ["path": path, "allocated": allocated]
        if let privateSize = privateSizeBytes(forPath: path) {
            supported = true
            item["privateSize"] = privateSize
        }
        items.append(item)
    }
    ok(["items": items, "privateSizeSupported": supported])
}

func cmdCapacity(_ args: [String]) throws {
    if args.count > 1 {
        throw CliError(message: "capacity: unexpected argument '\(args[1])'")
    }
    let path = expandPath(args.first ?? "/")
    let keys: Set<URLResourceKey> = [
        .volumeTotalCapacityKey,
        .volumeAvailableCapacityKey,
        .volumeAvailableCapacityForImportantUsageKey,
        .volumeAvailableCapacityForOpportunisticUsageKey,
    ]
    let values: URLResourceValues
    do {
        values = try URL(fileURLWithPath: path).resourceValues(forKeys: keys)
    } catch {
        throw CliError(message: "capacity failed for \(path): \(error.localizedDescription)")
    }
    let total = Int64(values.volumeTotalCapacity ?? 0)
    let available = Int64(values.volumeAvailableCapacity ?? 0)
    let importantUsage = values.volumeAvailableCapacityForImportantUsage ?? 0
    let opportunisticUsage = values.volumeAvailableCapacityForOpportunisticUsage ?? 0
    let purgeableEstimate = max(Int64(0), importantUsage - available)
    ok([
        "path": path,
        "total": total,
        "available": available,
        "importantUsage": importantUsage,
        "opportunisticUsage": opportunisticUsage,
        "purgeableEstimate": purgeableEstimate,
    ])
}

func cmdIcon(_ args: [String]) throws {
    var positional: [String] = []
    var size = 64
    var index = 0
    while index < args.count {
        let arg = args[index]
        if arg == "--size" {
            guard index + 1 < args.count, let parsed = Int(args[index + 1]), parsed > 0 else {
                throw CliError(message: "icon: --size requires a positive integer")
            }
            size = parsed
            index += 2
        } else {
            positional.append(arg)
            index += 1
        }
    }
    guard positional.count == 2 else {
        throw CliError(message: "icon: expected <appPath> <outPng>")
    }
    let appPath = expandPath(positional[0])
    let outPath = expandPath(positional[1])
    guard FileManager.default.fileExists(atPath: appPath) else {
        throw CliError(message: "icon: no such path \(appPath)")
    }

    let icon = NSWorkspace.shared.icon(forFile: appPath)
    icon.size = NSSize(width: size, height: size)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw CliError(message: "icon: could not allocate bitmap")
    }
    rep.size = NSSize(width: size, height: size)

    NSGraphicsContext.saveGraphicsState()
    if let context = NSGraphicsContext(bitmapImageRep: rep) {
        NSGraphicsContext.current = context
        icon.draw(
            in: NSRect(x: 0, y: 0, width: size, height: size),
            from: .zero,
            operation: .sourceOver,
            fraction: 1.0
        )
        context.flushGraphics()
    }
    NSGraphicsContext.restoreGraphicsState()

    guard let png = rep.representation(using: .png, properties: [:]) else {
        throw CliError(message: "icon: PNG encoding failed")
    }
    let outURL = URL(fileURLWithPath: outPath)
    do {
        try FileManager.default.createDirectory(
            at: outURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try png.write(to: outURL)
    } catch {
        throw CliError(message: "icon: write failed for \(outPath): \(error.localizedDescription)")
    }
    ok(["out": outPath])
}
