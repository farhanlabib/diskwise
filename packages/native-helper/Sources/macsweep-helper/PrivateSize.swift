import Darwin
import Foundation

// `ATTR_CMNEXT_PRIVATESIZE` is a "common extended" attribute: it is requested in
// the forkattr field of attrlist together with FSOPT_ATTR_CMN_EXTENDED. It reports
// the part of a file's allocated size that is not shared with other files (APFS
// clones), which is what actually gets reclaimed when the file is deleted.
//
// The returned buffer is the standard getattrlist layout: a u_int32_t byte length
// followed by the attribute values, each 4-byte aligned. Since only one attribute
// is requested and ATTR_CMN_RETURNED_ATTRS is not, the off_t value sits at offset 4.
private let attrCmnExtPrivateSize: UInt32 = 0x0000_0008
private let attrBitMapCount: UInt16 = 5
private let fsoptAttrCmnExtended: UInt32 = 0x0000_0020
private let lengthFieldSize = 4
private let privateSizeFieldSize = 8

func privateSizeBytes(forPath path: String) -> Int64? {
    var attrList = attrlist()
    attrList.bitmapcount = attrBitMapCount
    attrList.reserved = 0
    attrList.commonattr = 0
    attrList.volattr = 0
    attrList.dirattr = 0
    attrList.fileattr = 0
    attrList.forkattr = attrCmnExtPrivateSize

    var buffer = [UInt8](repeating: 0, count: lengthFieldSize + privateSizeFieldSize + 8)
    let result = path.withCString { cPath in
        withUnsafeMutablePointer(to: &attrList) { attrListPointer in
            buffer.withUnsafeMutableBytes { raw in
                getattrlist(cPath, attrListPointer, raw.baseAddress, raw.count, fsoptAttrCmnExtended)
            }
        }
    }
    guard result == 0 else { return nil }

    var value: Int64 = 0
    withUnsafeMutableBytes(of: &value) { destination in
        buffer.withUnsafeBytes { source in
            let start = source.baseAddress!.advanced(by: lengthFieldSize)
            destination.copyBytes(from: UnsafeRawBufferPointer(start: start, count: privateSizeFieldSize))
        }
    }
    guard value >= 0 else { return nil }
    return value
}
