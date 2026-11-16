"""Only MiniPets' own files ship. Reads every entry name in a finished zip and fails, naming each one, if any falls
outside the allowlist.

    python -I tools/zip-allowlist.py tools/zip-allowlist.txt <zip>

The allowlist's own header says how it is written. Entry names are read with ZipInfo.orig_filename, the name as
stored, because ZipInfo.filename turns backslashes into "/" on Windows and would hide one.
Exit codes: 0 every entry allowed, 1 one or more stray entries, 2 the zip or the allowlist couldn't be read, the
zip is empty, or the arguments are wrong (not knowing is a failure too).
"""
import sys
import zipfile


def read_allowlist(text):
    """(exact file paths, {folder prefix: extensions}) from the allowlist's text."""
    files, folders = set(), {}
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split()
        if parts[0].endswith('/'):
            extensions = parts[1:]
            if not extensions or not all(ext.startswith('.') and len(ext) > 1 for ext in extensions):
                raise ValueError(f'line {number}: a folder needs one or more extensions, such as .js')
            folders[parts[0]] = tuple(extensions)
        elif len(parts) == 1:
            files.add(parts[0])
        else:
            raise ValueError(f'line {number}: a file line holds one path')
        if '\\' in parts[0] or parts[0].startswith('/'):
            raise ValueError(f'line {number}: paths use "/" and start at the zip\'s root')
    if not files and not folders:
        raise ValueError('the allowlist allows nothing')
    return files, folders


def why_not(name, files, folders):
    """None when the entry may ship, else the reason it may not."""
    if '\\' in name:
        return 'a backslash in the name'
    if name.startswith('/') or (len(name) > 1 and name[1] == ':'):
        return 'an absolute path'
    parts = name.rstrip('/').split('/')
    if any(part in ('', '..') for part in parts):
        return 'an empty or ".." part in the path'
    if any(part.startswith('.') for part in parts):
        return 'a hidden file or folder'
    if name.endswith('/'):
        # a folder entry: one above an allowed path, or inside an allowed folder
        allowed = list(files) + list(folders)
        if any(path.startswith(name) for path in allowed) or any(name.startswith(folder) for folder in folders):
            return None
        return 'a folder that is not the mod\'s'
    if name in files:
        return None
    for folder, extensions in folders.items():
        if name.startswith(folder):
            if name.endswith(extensions):
                return None
            return f'not one of {" ".join(extensions)} in {folder}'
    return 'not in the allowlist'


def main(argv):
    if len(argv) != 3:
        print('usage: python -I tools/zip-allowlist.py tools/zip-allowlist.txt <zip>')
        return 2
    try:
        with open(argv[1], encoding='utf-8') as handle:
            files, folders = read_allowlist(handle.read())
        with zipfile.ZipFile(argv[2]) as archive:
            names = [info.orig_filename for info in archive.infolist()]
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f'zip allowlist: could not check: {error}')
        return 2
    if not names:
        print('zip allowlist: the zip is empty')
        return 2
    stray = [(name, why_not(name, files, folders)) for name in names]
    stray = [(name, reason) for name, reason in stray if reason]
    for name, reason in stray:
        print(f'zip allowlist: not allowed: {name} ({reason})')
    print(f'zip allowlist: {len(names) - len(stray)} of {len(names)} entries allowed')
    return 1 if stray else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
