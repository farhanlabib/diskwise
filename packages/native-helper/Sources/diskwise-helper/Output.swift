import Darwin
import Foundation

// Every invocation writes exactly one JSON object to stdout. Nothing else is
// ever written to stdout, so the wrapper can parse it blindly.

func emit(_ object: [String: Any]) {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

func ok(_ fields: [String: Any] = [:]) -> Never {
    var object = fields
    object["ok"] = true
    emit(object)
    exit(0)
}

func fail(_ message: String) -> Never {
    emit(["ok": false, "error": message])
    exit(1)
}

// A failure that still reports the command's own fields (e.g. quit-app reports
// quit/stillRunning next to the error).
func fail(_ fields: [String: Any], message: String) -> Never {
    var object = fields
    object["ok"] = false
    object["error"] = message
    emit(object)
    exit(1)
}

struct CliError: Error {
    let message: String
}

func expandPath(_ path: String) -> String {
    (path as NSString).expandingTildeInPath
}
