import Foundation

let helperVersion = "0.1.0"
let knownCommands = ["trash", "running-apps", "quit-app", "privatesize", "capacity", "icon", "version"]

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else {
    fail("missing command; expected one of: \(knownCommands.joined(separator: ", "))")
}
let rest = Array(arguments.dropFirst())

do {
    switch command {
    case "trash":
        try cmdTrash(rest)
    case "running-apps":
        try cmdRunningApps(rest)
    case "quit-app":
        try cmdQuitApp(rest)
    case "privatesize":
        try cmdPrivateSize(rest)
    case "capacity":
        try cmdCapacity(rest)
    case "icon":
        try cmdIcon(rest)
    case "version":
        ok(["version": helperVersion])
    default:
        fail("unknown command '\(command)'; expected one of: \(knownCommands.joined(separator: ", "))")
    }
} catch let error as CliError {
    fail(error.message)
} catch {
    fail("\(error)")
}
