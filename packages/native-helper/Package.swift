// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "diskwise-helper",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "diskwise-helper",
            path: "Sources/diskwise-helper"
        )
    ]
)
