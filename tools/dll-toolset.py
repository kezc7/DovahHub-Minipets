"""A release DLL is built by one toolset, start to finish. A DLL linked by a newer Visual Studio, or holding
objects a newer one compiled (a package built earlier by it), needs a Visual C++ runtime at least that new on the
player's PC.

    python tools/dll-toolset.py <dll> --linker 14.4 --below 35700

Reads the DLL's linker version from its PE header and every compiler and linker build number from its Rich header,
and fails if the linker version does not start with --linker or any build number is --below or higher.
(Visual Studio 2022's 14.44 is builds 35207 to 35230; the older entries come from the Windows SDK and runtime
libraries.) Exit codes: 0 fine, 1 the wrong toolset, 2 the file or its headers couldn't be read or the arguments
are wrong (not knowing is a failure too).
"""
import struct
import sys


def linker_version(data):
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    if data[:2] != b'MZ' or data[pe:pe + 4] != b'PE\0\0':
        raise ValueError('not a PE file')
    return f'{data[pe + 26]}.{data[pe + 27]}'


def rich_builds(data):
    """[(build number, product id, object count)] from the Rich header, which sits between the DOS stub and PE."""
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    end = data.find(b'Rich', 0x40, pe)
    if end < 0:
        raise ValueError('no Rich header')
    key = struct.unpack_from('<I', data, end + 4)[0]
    words, at = [], end - 4
    while at >= 0x40:
        word = struct.unpack_from('<I', data, at)[0] ^ key
        if word == 0x536e6144:  # "DanS", where the header starts
            break
        words.append(word)
        at -= 4
    else:
        raise ValueError('the Rich header has no start')
    words.reverse()
    words = words[3:]  # three padding words follow the start
    return [(words[i] & 0xffff, words[i] >> 16, words[i + 1]) for i in range(0, len(words) - 1, 2)]


def main(argv):
    try:
        path, linker, below = argv[1], argv[argv.index('--linker') + 1], int(argv[argv.index('--below') + 1])
    except (IndexError, ValueError):
        print(__doc__.strip())
        return 2
    try:
        with open(path, 'rb') as file:
            data = file.read()
        version, builds = linker_version(data), rich_builds(data)
    except (OSError, ValueError, struct.error) as error:
        print(f'toolset: {path}: {error}')
        return 2
    if not builds:
        print(f'toolset: {path}: the Rich header is empty')
        return 2
    newer = sorted({build for build, _, _ in builds if build >= below})
    objects = sum(count for build, _, count in builds if build >= below)
    print(f'toolset: linker {version}; {len(builds)} Rich entries, highest build {max(build for build, _, _ in builds)}')
    failed = False
    if not version.startswith(linker):
        print(f'toolset: linked by {version}, not {linker}x')
        failed = True
    if newer:
        print(f'toolset: {objects} object(s) from build(s) {", ".join(map(str, newer))}, which are {below} or higher')
        failed = True
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
