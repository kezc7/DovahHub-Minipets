"""Tests for tools/pex-header.py. Run: python tools/test-pex-header.py (exit code 0 when every test passes).

They build their own small .pex headers, so they need no compiler and no game files.
"""
import contextlib
import importlib.util
import io
import pathlib
import struct
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True  # no __pycache__ beside the tool: a release needs a clean working tree
HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('pex_header', HERE / 'pex-header.py')
pex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pex)

BODY = b'\x00\x05the string table and everything after it'


def make(source=b'DFC.psc', user=b'someone', machine=b'SOME-PC', body=BODY):
    data = struct.pack('>IBBHQ', pex.MAGIC, 3, 2, 1, 1794431536)
    for text in (source, user, machine):
        data += struct.pack('>H', len(text)) + text
    return data + body


class PexHeaderTests(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self._dir.name)

    def tearDown(self):
        self._dir.cleanup()

    def write(self, name, data):
        path = self.dir / name
        path.write_bytes(data)
        return str(path)

    def zip(self, name, files):
        path = self.dir / name
        with zipfile.ZipFile(path, 'w') as archive:
            for entry, data in files.items():
                archive.writestr(entry, data)
        return str(path)

    def run_tool(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = pex.main(['pex-header.py', *args])
        return code, out.getvalue()

    # ---- what counts as a problem

    def test_names_from_the_compiler_are_problems(self):
        self.assertEqual(pex.problems(make(), 'a.pex'), ['the user name is set', 'the machine name is set'])
        self.assertEqual(pex.problems(make(user=b''), 'a.pex'), ['the machine name is set'])
        self.assertEqual(pex.problems(make(user=b'', machine=b''), 'a.pex'), [])

    def test_a_source_name_with_a_path_is_a_problem(self):
        for source in (b'C:\\build\\DFC.psc', b'scripts/DFC.psc', b'D:DFC.psc'):
            self.assertEqual(pex.problems(make(source, b'', b''), 'a.pex'), ['the source file name has a path'])

    def test_an_empty_source_name_is_a_problem(self):
        self.assertEqual(pex.problems(make(b'', b'', b''), 'a.pex'), ['the source file name is empty'])
        self.assertEqual(pex.problems(make(b''), 'a.pex'),
                         ['the user name is set', 'the machine name is set', 'the source file name is empty'])

    def test_anything_else_is_not_a_pex(self):
        for data in (b'', b'not a script', make()[:17], struct.pack('>I', 0xDEC057FA) + make()[4:]):
            with self.assertRaises(ValueError):
                pex.problems(data, 'a.pex')

    # ---- scrub

    def test_scrub_blanks_the_names_and_keeps_the_rest(self):
        path = self.write('a.pex', make(b'C:\\build\\DFC.psc'))
        self.assertTrue(pex.scrub(path))
        data = pathlib.Path(path).read_bytes()
        self.assertEqual(pex.parse(data, path)[:3], (b'DFC.psc', b'', b''))
        self.assertEqual(data[:pex.FIXED], make()[:pex.FIXED])  # version, game and compile time as they were
        self.assertTrue(data.endswith(BODY))
        self.assertEqual(len(data), pex.FIXED + 2 + len(b'DFC.psc') + 2 + 2 + len(BODY))
        self.assertEqual(pex.problems(data, path), [])
        self.assertFalse(pex.scrub(path))  # nothing left to do
        self.assertEqual(pathlib.Path(path).read_bytes(), data)

    def test_scrub_leaves_every_kind_of_path_bare(self):
        # A drive-relative name has a colon and no slash; check refuses it, so scrub must clean it too.
        cases = {
            b'C:DKS_GuestQuest.psc': b'DKS_GuestQuest.psc',
            b'C:\\build\\DFC.psc': b'DFC.psc',
            b'D:/src/scripts/DFC.psc': b'DFC.psc',
            b'scripts\\sub/DFC.psc': b'DFC.psc',
            b'\\\\server\\share\\DFC.psc': b'DFC.psc',
            b'DFC.psc': b'DFC.psc',
        }
        for i, (source, bare) in enumerate(cases.items()):
            path = self.write(f'{i}.pex', make(source, b'', b''))
            self.assertEqual(pex.scrub(path), source != bare, source)
            data = pathlib.Path(path).read_bytes()
            self.assertEqual(pex.parse(data, path)[0], bare, source)
            self.assertEqual(pex.problems(data, path), [], source)  # whatever scrub leaves, check accepts
            self.assertTrue(data.endswith(BODY))

    def test_scrub_of_a_bare_drive_leaves_nothing_and_check_says_so(self):
        path = self.write('a.pex', make(b'C:', b'', b''))
        self.assertTrue(pex.scrub(path))
        self.assertEqual(pex.problems(pathlib.Path(path).read_bytes(), path), ['the source file name is empty'])

    def test_scrub_cannot_invent_a_source_name(self):
        path = self.write('a.pex', make(b''))
        pex.scrub(path)
        self.assertEqual(pex.problems(pathlib.Path(path).read_bytes(), path), ['the source file name is empty'])

    # ---- check, as the release runs it

    def test_check_passes_a_clean_zip_and_counts_its_scripts(self):
        clean = make(user=b'', machine=b'')
        path = self.zip('mod.zip', {'Scripts/A.pex': clean, 'scripts/B.PEX': clean, 'readme.txt': b'x'})
        code, out = self.run_tool('check', path)
        self.assertEqual(code, 0)
        self.assertIn(f'2 of 2 .pex files clean in {path}', out)

    def test_check_fails_and_names_the_file_but_never_the_names(self):
        path = self.zip('mod.zip', {'Scripts/A.pex': make(user=b'', machine=b''), 'Scripts/B.pex': make()})
        code, out = self.run_tool('check', path)
        self.assertEqual(code, 1)
        self.assertIn('Scripts/B.pex', out)
        self.assertIn('the user name is set; the machine name is set', out)
        self.assertIn('1 of 2 .pex files clean', out)
        self.assertNotIn('someone', out)
        self.assertNotIn('SOME-PC', out)

    def test_check_fails_on_an_empty_source_name_in_a_zip(self):
        path = self.zip('mod.zip', {'Scripts/A.pex': make(b'', b'', b'')})
        code, out = self.run_tool('check', path)
        self.assertEqual(code, 1)
        self.assertIn('the source file name is empty', out)

    def test_check_fails_on_a_zip_with_no_scripts(self):
        path = self.zip('mod.zip', {'readme.txt': b'x'})
        code, out = self.run_tool('check', path)
        self.assertEqual(code, 1)
        self.assertIn('0 of 0 .pex files clean', out)
        self.assertIn('no .pex files in', out)

    def test_allow_none_passes_a_zip_meant_to_have_no_scripts(self):
        empty = self.zip('source.zip', {'readme.txt': b'x'})
        for args in (('check', '--allow-none', empty), ('check', empty, '--allow-none')):
            code, out = self.run_tool(*args)
            self.assertEqual(code, 0)
            self.assertIn('0 of 0 .pex files clean', out)
        # It only excuses having none: a bad script still fails.
        bad = self.zip('bad.zip', {'A.pex': make()})
        self.assertEqual(self.run_tool('check', '--allow-none', bad)[0], 1)

    def test_one_empty_zip_fails_the_whole_check(self):
        good = self.zip('mod.zip', {'A.pex': make(user=b'', machine=b'')})
        empty = self.zip('other.zip', {'readme.txt': b'x'})
        self.assertEqual(self.run_tool('check', good, empty)[0], 1)

    def test_check_takes_a_single_pex_file(self):
        self.assertEqual(self.run_tool('check', self.write('a.pex', make(user=b'', machine=b'')))[0], 0)
        self.assertEqual(self.run_tool('check', self.write('b.pex', make()))[0], 1)

    def test_unreadable_input_and_bad_arguments_exit_2(self):
        self.assertEqual(self.run_tool('check', str(self.dir / 'missing.zip'))[0], 2)
        self.assertEqual(self.run_tool('check', self.write('broken.zip', b'not a zip'))[0], 2)
        self.assertEqual(self.run_tool('check', self.zip('junk.zip', {'A.pex': b'junk'}))[0], 2)
        self.assertEqual(self.run_tool('check')[0], 2)
        self.assertEqual(self.run_tool('check', '--allow-none')[0], 2)
        self.assertEqual(self.run_tool('check', '--allow-nothing', 'x.zip')[0], 2)
        self.assertEqual(self.run_tool('scrub', '--allow-none', 'x.pex')[0], 2)
        self.assertEqual(self.run_tool('show', 'x.pex')[0], 2)


if __name__ == '__main__':
    unittest.main(verbosity=1)
