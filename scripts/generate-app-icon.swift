import AppKit
import Foundation

let rootURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assetsURL = rootURL.appendingPathComponent("assets", isDirectory: true)
let buildURL = rootURL.appendingPathComponent("build", isDirectory: true)
let iconsetURL = buildURL.appendingPathComponent("AppIcon.iconset", isDirectory: true)
let sourceArguments = CommandLine.arguments.dropFirst()
guard let sourceIconPath = sourceArguments.first else {
  throw NSError(
    domain: "YobuIcon",
    code: 3,
    userInfo: [NSLocalizedDescriptionKey: "사용법: swift scripts/generate-app-icon.swift /path/to/icon.png"]
  )
}
let sourceIconURL = URL(fileURLWithPath: sourceIconPath)

try FileManager.default.createDirectory(at: assetsURL, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: iconsetURL, withIntermediateDirectories: true)

func stroke(_ path: NSBezierPath, color strokeColor: NSColor, width: CGFloat, glow: CGFloat = 0) {
  path.lineWidth = width
  path.lineCapStyle = .round
  path.lineJoinStyle = .round

  strokeColor.setStroke()
  path.stroke()
}

func writePNG(_ image: NSImage, to url: URL) throws {
  guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let data = bitmap.representation(using: .png, properties: [:])
  else {
    throw NSError(domain: "YobuIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "PNG 데이터를 만들 수 없습니다."])
  }

  try data.write(to: url)
}

func run(_ executable: String, _ arguments: [String]) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: executable)
  process.arguments = arguments
  try process.run()
  process.waitUntilExit()

  if process.terminationStatus != 0 {
    throw NSError(
      domain: "YobuIcon",
      code: Int(process.terminationStatus),
      userInfo: [NSLocalizedDescriptionKey: "\(executable) 실행에 실패했습니다."]
    )
  }
}

func drawTrayIcon(size: CGFloat = 64) -> NSImage {
  let scale = size / 64
  let image = NSImage(size: NSSize(width: size, height: size))
  image.lockFocus()
  NSColor.clear.setFill()
  NSRect(x: 0, y: 0, width: size, height: size).fill()

  let circle = NSBezierPath(ovalIn: NSRect(x: 5 * scale, y: 5 * scale, width: 54 * scale, height: 54 * scale))
  stroke(circle, color: .black, width: 4 * scale)

  let mark = NSBezierPath()
  mark.move(to: NSPoint(x: 20 * scale, y: 45 * scale))
  mark.line(to: NSPoint(x: 32 * scale, y: 28 * scale))
  mark.line(to: NSPoint(x: 44 * scale, y: 45 * scale))
  mark.move(to: NSPoint(x: 32 * scale, y: 28 * scale))
  mark.curve(
    to: NSPoint(x: 23 * scale, y: 15 * scale),
    controlPoint1: NSPoint(x: 35 * scale, y: 21 * scale),
    controlPoint2: NSPoint(x: 29 * scale, y: 15 * scale)
  )
  stroke(mark, color: .black, width: 7 * scale)

  image.unlockFocus()
  return image
}

let appIconURL = assetsURL.appendingPathComponent("app-icon.png")
let trayIconURL = assetsURL.appendingPathComponent("tray-icon.png")

guard FileManager.default.fileExists(atPath: sourceIconURL.path) else {
  throw NSError(
    domain: "YobuIcon",
    code: 2,
    userInfo: [NSLocalizedDescriptionKey: "원본 아이콘 파일을 찾을 수 없습니다: \(sourceIconURL.path)"]
  )
}

if FileManager.default.fileExists(atPath: appIconURL.path) {
  try FileManager.default.removeItem(at: appIconURL)
}
try FileManager.default.copyItem(at: sourceIconURL, to: appIconURL)

try writePNG(drawTrayIcon(), to: trayIconURL)
try run("/usr/bin/sips", ["-z", "64", "64", trayIconURL.path, "--out", trayIconURL.path])

let iconTargets: [(String, Int)] = [
  ("icon_16x16.png", 16),
  ("icon_16x16@2x.png", 32),
  ("icon_32x32.png", 32),
  ("icon_32x32@2x.png", 64),
  ("icon_128x128.png", 128),
  ("icon_128x128@2x.png", 256),
  ("icon_256x256.png", 256),
  ("icon_256x256@2x.png", 512),
  ("icon_512x512.png", 512),
  ("icon_512x512@2x.png", 1024),
]

for (fileName, pixelSize) in iconTargets {
  try run("/usr/bin/sips", [
    "-z",
    "\(pixelSize)",
    "\(pixelSize)",
    appIconURL.path,
    "--out",
    iconsetURL.appendingPathComponent(fileName).path,
  ])
}

try run("/usr/bin/iconutil", [
  "-c",
  "icns",
  iconsetURL.path,
  "-o",
  buildURL.appendingPathComponent("icon.icns").path,
])

print("Generated Yobu app icon assets.")
