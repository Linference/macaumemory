import unittest
from annotation_bridge import audit, check_split, evaluate, valid_box


class BridgeTests(unittest.TestCase):
    def test_invalid_accepted_box_fails_audit(self):
        self.assertTrue(audit([{'frame':'a.jpg','accepted':True,'yolo':[.5,.5,2,1]}])['errors'])
        self.assertFalse(valid_box([.5,.5,float('nan'),1]))

    def test_no_truth_never_produces_accuracy(self):
        r=evaluate([],{'labels':[]})
        self.assertIsNone(r['meanIoUIncludingMisses'])
        self.assertEqual(r['status'],'awaiting-independent-review')

    def test_misses_and_negative_false_acceptances_are_counted(self):
        predictions=[{'frame':'a.jpg','accepted':True,'yolo':[.5,.5,.5,.5]},
                     {'frame':'b.jpg','accepted':False},
                     {'frame':'c.jpg','accepted':True,'yolo':[.5,.5,.5,.5]}]
        truth={'labels':[{'frame':'a.jpg','bbox':[.5,.5,.5,.5]},
                         {'frame':'b.jpg','bbox':[.5,.5,.5,.5]}, {'frame':'c.jpg','bbox':None}]}
        r=evaluate(predictions,truth)
        self.assertEqual(r['meanIoUIncludingMisses'],.5)
        self.assertEqual(r['recallAtIoU50'],.5)
        self.assertEqual(r['precisionAtIoU50'],.5)
        self.assertEqual(r['negativeFalseAcceptance'],1)

    def test_capture_and_image_leakage_are_rejected(self):
        manifest={'samples':[{'sessionId':'one','split':'train','sha256':'same'}]}
        for session, hashes in [('one',{'different'}),('two',{'same'})]:
            with self.assertRaises(ValueError):check_split(manifest,session,'test',hashes)
        check_split(manifest,'two','test',{'different'})

    def test_duplicate_truth_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate([{'frame':'a.jpg','accepted':False}],{'labels':[{'frame':'a.jpg','bbox':None}]*2})


if __name__=='__main__':unittest.main()
