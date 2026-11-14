"""A compiled Papyrus script (.pex) names the PC that compiled it: its header holds the source file name, the
user name and the machine name. A release must not carry the last two, and the source name must be bare.

    python tools/pex-header.py scrub <file.pex>...                      blanks the user and machine names, strips any path or drive
    python tools/pex-header.py check [--allow-none] <zip or .pex>...    fails if any .pex still has them (never prints them)

check also fails on a zip with no .pex in it, since a release that should hold scripts and holds none must not
pass. Give --allow-none for a zip that is meant to have none (a source archive). Exit codes: 0 clean, 1 a
problem was found, 2 a file couldn't be read or the arguments are wrong.

The header is: magic FA57C0DE, version (2 bytes), game (2), compile time (8), then three strings, each a 2-byte
big-endian length and that many bytes. Nothing later in the file points back by offset, so they can change length.
tools/test-pex-header.py holds the tests.
"""
import struct
import sys
import zipfile

MAGIC = 0xFA57C0DE
FIXED = 16  # magic, major, minor, game id, compile time


def parse(data, name):
    """(source, user, machine, offset after the three strings)."""
    if len(data) < FIXED + 6 or struct.unpack('>I', data[:4])[0] != MAGIC:
        raise ValueError(f'{name} is not a Skyrim .pex file')
    at, strings = FIXED, []
    for _ in range(3):
        if at + 2 > len(data):
            raise ValueError(f'{name} has a cut-short header')
        size = struct.unpack('>H', data[at:at + 2])[0]
        strings.append(data[at + 2:at + 2 + size])
        at += 2 + size
    if at > len(data):
        raise ValueError(f'{name} has a cut-short header')
    return strings[0], strings[1], strings[2], at


def problems(data, name):
    source, user, machine, _ = parse(data, name)
    found = []
    if user:
        found.append('the user name is set')
    if machine:
        found.append('the machine name is set')
    if not source:
        found.append('the source file name is empty')
    elif b'\\' in source or b'/' in source or b':' in source:
        found.append('the source file name has a path')
    return found


def scrub(path):
    with open(path, 'rb') as file:
        data = file.read()
    source, user, machine, rest = parse(data, path)
    # What follows the last slash, backslash or colon: a drive-relative name ("C:Name.psc") has no slash.
    bare = source.replace(b'\\', b'/').replace(b':', b'/').split(b'/')[-1]
    if not user and not machine and bare == source:
        return False
    header = data[:FIXED] + struct.pack('>H', len(bare)) + bare + struct.pack('>H', 0) + struct.pack('>H', 0)
    with open(path, 'wb') as file:
        file.write(header + data[rest:])
    return True


def check(path):
    """[(name, [problem...])] for every .pex in a zip, or for one .pex file; and how many were looked at."""
    bad, count = [], 0
    if path.lower().endswith('.zip'):
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                if info.orig_filename.lower().endswith('.pex'):
                    count += 1
                    found = problems(archive.read(info), info.orig_filename)
                    if found:
                        bad.append((info.orig_filename, found))
    else:
        count = 1
        with open(path, 'rb') as file:
            found = problems(file.read(), path)
        if found:
            bad.append((path, found))
    return bad, count


def main(argv):
    args = argv[2:]
    allow_none = '--allow-none' in args
    paths = [arg for arg in args if arg != '--allow-none']
    unknown = [arg for arg in paths if arg.startswith('--')]
    if len(argv) < 2 or argv[1] not in ('scrub', 'check') or not paths or unknown or (allow_none and argv[1] != 'check'):
        print(__doc__.strip())
        return 2
    try:
        if argv[1] == 'scrub':
            changed = sum(scrub(path) for path in paths)
            print(f'pex headers: {changed} of {len(paths)} cleaned (user and machine names blank, source name bare)')
            return 0
        failed = False
        for path in paths:
            bad, count = check(path)
            for name, found in bad:
                print(f'pex headers: {name} in {path}: {"; ".join(found)}')
            failed = failed or bool(bad)
            print(f'pex headers: {count - len(bad)} of {count} .pex files clean in {path}')
            if count == 0 and not allow_none:
                print(f'pex headers: no .pex files in {path}; pass --allow-none if it is meant to have none')
                failed = True
        return 1 if failed else 0
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f'pex headers: {error}')
        return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
