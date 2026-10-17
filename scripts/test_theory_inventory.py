import base64,contextlib,hashlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
source=Path(__file__).with_name('fetch-vla-github.py')
if not source.exists():source=Path(__file__).parent/'source/fetch-vla-github.py'
spec=importlib.util.spec_from_file_location('inventory',source)
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
def blob(text):
    raw=text.encode();sha=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    return {'sha':sha,'content':base64.b64encode(raw).decode()}
def entry(path,sha):return {'path':path,'type':'blob','sha':sha}
class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=Path(__file__).parent);self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'index.json';self.path.write_text('{"articles":[]}')
        self.guard=patch.object(sync,'OUTPUT_FILE',self.path);self.guard.start();self.addCleanup(self.guard.stop)
    def run_sync(self,tree,payload):
        with patch.object(sync,'load_env',return_value={'GITHUB_TOKEN':'fixture-secret'}),patch.object(sync,'github_api',side_effect=[tree,payload]),patch.object(sync.time,'sleep'),contextlib.redirect_stdout(io.StringIO()) as stdout:
            sync.main()
        self.assertNotIn('fixture-secret',stdout.getvalue())
        return json.loads(self.path.read_text())
    def test_all_files_after_300_are_included(self):
        files=[entry('theory/vla-core/%04d.md'%i,'a'*40) for i in range(707)]
        self.assertEqual(len(sync.select_theory_files({'tree':files,'truncated':False})),707)
        self.assertEqual(sync.select_theory_files({'tree':files})[-1]['path'],'theory/vla-core/0706.md')
    def test_truncated_duplicate_empty_and_over_limit_rejected(self):
        item=entry('theory/tactile/paper.md','a'*40)
        for tree in [{'tree':[item],'truncated':True},{'tree':[]},{'tree':[item,item]},{'tree':[entry('theory/x/%d.md'%i,'a'*40) for i in range(5001)]}]:
            with self.assertRaises(ValueError):sync.select_theory_files(tree)
    def test_explicit_document_dates_and_invalid_dates(self):
        for text in ['> ⚙️ 本文由 Moltbot 自动生成 | 2026-10-17','> **日期**: 2026-10-17','date: 2026-10-17']:
            self.assertEqual(sync.extract_document_date(blob(text)['content']),'2026-10-17')
        for text in ['Paper submitted 2026-10-17','> **日期**: 2026-02-30','> **日期**: 2026-10-16\n> **日期**: 2026-10-17']:
            self.assertIsNone(sync.extract_document_date(blob(text)['content']))
    def test_newly_discovered_undated_old_article_is_not_marked_today(self):
        payload=blob('# Historical chapter\nNo article publication date.')
        out=self.run_sync({'sha':'b'*40,'tree':[entry('theory/foundation/old.md',payload['sha'])]},payload)
        self.assertEqual(out['articles'][0]['date'],'');self.assertTrue(out['complete']);self.assertEqual(out['article_count'],1)
    def test_new_article_uses_document_date_and_exact_blob(self):
        payload=blob('# Paper\n> ⚙️ 本文由 Moltbot 自动生成 | 2026-10-17')
        out=self.run_sync({'sha':'b'*40,'tree':[entry('theory/tactile/new.md',payload['sha'])]},payload)
        self.assertEqual(out['articles'][0]['date'],'2026-10-17');self.assertEqual(out['articles'][0]['title'],'Paper')
    def test_sha_mismatch_preserves_old_index(self):
        before=self.path.read_bytes();payload=blob('# Wrong article')
        with self.assertRaisesRegex(ValueError,'integrity'):
            self.run_sync({'tree':[entry('theory/tactile/new.md','a'*40)]},payload)
        self.assertEqual(self.path.read_bytes(),before)
    def test_transport_and_disk_failure_preserve_old_index(self):
        before=self.path.read_bytes();payload=blob('# Paper')
        with patch.object(sync.os,'replace',side_effect=OSError('disk failure')),self.assertRaises(OSError):
            self.run_sync({'tree':[entry('theory/tactile/new.md',payload['sha'])]},payload)
        self.assertEqual(self.path.read_bytes(),before)
    def test_cached_unknown_date_does_not_refetch_or_invent_date(self):
        path='theory/foundation/old.md';self.path.write_text(json.dumps({'articles':[{'path':path,'sha':'a'*40,'date':None,'title':'Old'}]}))
        tree={'tree':[entry(path,'a'*40)]}
        with patch.object(sync,'load_env',return_value={'GITHUB_TOKEN':'fixture'}),patch.object(sync,'github_api',return_value=tree) as api,contextlib.redirect_stdout(io.StringIO()):
            sync.main()
        self.assertEqual(api.call_count,1);self.assertEqual(json.loads(self.path.read_text())['articles'][0]['date'],'')

if __name__=='__main__':unittest.main()
