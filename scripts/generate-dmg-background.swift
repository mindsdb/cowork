import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
let assets = root.appendingPathComponent("assets", isDirectory: true)
let logoPath = assets.appendingPathComponent("logo.jpg").path
let outPngPath = assets.appendingPathComponent("dmg-background.png").path
let outTiffPath = assets.appendingPathComponent("dmg-background.tiff").path

let width = 1200
let height = 800

guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: width,
  pixelsHigh: height,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("Failed to allocate bitmap.\n", stderr)
  exit(1)
}

guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
  fputs("Failed to create graphics context.\n", stderr)
  exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
let cg = context.cgContext

func yFromTop(_ yTop: CGFloat, h: CGFloat) -> CGFloat {
  return CGFloat(height) - yTop - h
}

func backgroundColor(from imagePath: String) -> NSColor {
  guard
    let image = NSImage(contentsOfFile: imagePath),
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let sample = bitmap.colorAt(x: 0, y: 0)
  else {
    return NSColor(calibratedRed: 0x11 / 255.0, green: 0x20 / 255.0, blue: 0x31 / 255.0, alpha: 1)
  }

  return sample.usingColorSpace(.deviceRGB) ?? sample
}

let logoBackgroundColor = backgroundColor(from: logoPath)
cg.setFillColor(logoBackgroundColor.cgColor)
cg.fill(CGRect(x: 0, y: 0, width: width, height: height))

// Subtle vignette/gradient to avoid flat look.
let gradientColors: [CGColor] = [
  NSColor(calibratedRed: 0x06 / 255.0, green: 0x14 / 255.0, blue: 0x2D / 255.0, alpha: 0.35).cgColor,
  NSColor(calibratedRed: 0x17 / 255.0, green: 0x24 / 255.0, blue: 0x33 / 255.0, alpha: 0.25).cgColor
]
let colorSpace = CGColorSpaceCreateDeviceRGB()
if let gradient = CGGradient(colorsSpace: colorSpace, colors: gradientColors as CFArray, locations: [0.0, 1.0]) {
  cg.drawLinearGradient(gradient, start: CGPoint(x: 0, y: CGFloat(height)), end: CGPoint(x: CGFloat(width), y: 0), options: [])
}

// Exact provided logo.
if let logo = NSImage(contentsOfFile: logoPath) {
  let logoRect = CGRect(x: 270, y: yFromTop(92, h: 190), width: 660, height: 190)
  logo.draw(in: logoRect, from: .zero, operation: .sourceOver, fraction: 1.0)
}

// Separator line.
cg.setFillColor(NSColor(calibratedRed: 0.37, green: 0.63, blue: 0.95, alpha: 0.55).cgColor)
cg.fill(CGRect(x: 120, y: yFromTop(420, h: 2), width: 960, height: 2))

// Arrow between app and Applications.
let arrowPath = NSBezierPath()
arrowPath.move(to: CGPoint(x: 510, y: yFromTop(522, h: 0)))
arrowPath.line(to: CGPoint(x: 622, y: yFromTop(522, h: 0)))
arrowPath.line(to: CGPoint(x: 622, y: yFromTop(488, h: 0)))
arrowPath.line(to: CGPoint(x: 710, y: yFromTop(560, h: 0)))
arrowPath.line(to: CGPoint(x: 622, y: yFromTop(632, h: 0)))
arrowPath.line(to: CGPoint(x: 622, y: yFromTop(598, h: 0)))
arrowPath.line(to: CGPoint(x: 510, y: yFromTop(598, h: 0)))
arrowPath.close()
NSColor(calibratedRed: 0.22, green: 0.27, blue: 0.33, alpha: 0.62).setFill()
arrowPath.fill()
NSColor(calibratedRed: 0.48, green: 0.53, blue: 0.60, alpha: 0.72).setStroke()
arrowPath.lineWidth = 4
arrowPath.stroke()

let arrowInner = NSBezierPath()
arrowInner.move(to: CGPoint(x: 536, y: yFromTop(560, h: 0)))
arrowInner.line(to: CGPoint(x: 660, y: yFromTop(560, h: 0)))
NSColor(calibratedRed: 0.32, green: 0.36, blue: 0.42, alpha: 0.78).setStroke()
arrowInner.lineWidth = 2
arrowInner.stroke()

// White cards behind native Finder labels.
let labelCardTop: CGFloat = 575
let labelCardHeight: CGFloat = 44
let leftIconCenterX: CGFloat = 300
let rightIconCenterX: CGFloat = 900
let leftCardWidth: CGFloat = 200
let rightCardWidth: CGFloat = 200

let leftCard = NSBezierPath(
  roundedRect: CGRect(
    x: leftIconCenterX - (leftCardWidth / 2),
    y: yFromTop(labelCardTop, h: labelCardHeight),
    width: leftCardWidth,
    height: labelCardHeight
  ),
  xRadius: 14,
  yRadius: 14
)
let rightCard = NSBezierPath(
  roundedRect: CGRect(
    x: rightIconCenterX - (rightCardWidth / 2),
    y: yFromTop(labelCardTop, h: labelCardHeight),
    width: rightCardWidth,
    height: labelCardHeight
  ),
  xRadius: 14,
  yRadius: 14
)
NSColor(calibratedRed: 0.93, green: 0.94, blue: 0.96, alpha: 1.0).setFill()
leftCard.fill()
rightCard.fill()

NSGraphicsContext.restoreGraphicsState()

guard let pngData = rep.representation(using: .png, properties: [:]) else {
  fputs("Failed to encode PNG.\n", stderr)
  exit(1)
}
try pngData.write(to: URL(fileURLWithPath: outPngPath), options: .atomic)

guard let tiffData = rep.representation(using: .tiff, properties: [:]) else {
  fputs("Failed to encode TIFF.\n", stderr)
  exit(1)
}
try tiffData.write(to: URL(fileURLWithPath: outTiffPath), options: .atomic)

print("Generated \(outPngPath)")
print("Generated \(outTiffPath)")
