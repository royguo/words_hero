"""Teacher updates exercised only by the isolated D1/R2 acceptance runner."""
import concurrent.futures
import uuid


def check_classroom_updates(request, source):
    source_id = source['class_id']
    source_before, _ = request('/api/lessons/' + source['id'])
    request('/api/classes/' + source_id + '/copy', {'name': 'invalid'}, status=400)
    request('/api/classes/missing/copy', {'name': 'missing', 'request_id': uuid.uuid4().hex}, status=404)
    payload = {'name': 'Copied teaching class', 'request_id': uuid.uuid4().hex}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        copies = list(pool.map(lambda _: request('/api/classes/' + source_id + '/copy', payload, status=201)[0], range(2)))
    assert copies[0]['id'] == copies[1]['id'], 'lost acknowledgments must not duplicate classes'
    target_id = copies[0]['id']
    replay, _ = request('/api/classes/' + source_id + '/copy', payload, status=201)
    assert replay['id'] == target_id
    request('/api/classes/' + target_id + '/copy', payload, status=409)
    state, _ = request('/api/state?class_id=' + target_id)
    assert len(state['lessons']) == 1 and state['learned'] == 0  # deleted source course excluded
    copied, _ = request('/api/lessons/' + state['lessons'][0]['id'])
    assert copied['version_id'] != source['version_id'] and copied['course_code'] != source['course_code']
    assert copied['version_number'] == 1 and len(copied['versions']) == 1
    for key in ('materials', 'groups'):
        assert copied[key] == source[key]
    assert copied['words'] == source['words']
    students, _ = request('/api/classes/' + target_id + '/students')
    assert students['students'] == []

    # Read-only lookup checks all vocabularies; it must not update classroom progress.
    group = next(g for g in copied['groups'] if g['words'])
    answer = group['words'][0]['word']
    checked, _ = request('/api/versions/' + copied['version_id'] + '/root-check', {
        'group_id': group['id'], 'answers': [answer.upper(), 'zzmissingword', 'mother'],
    })
    assert checked['results'][0]['found'] and checked['results'][0]['matched']
    assert not checked['results'][1]['found']
    assert checked['results'][2]['found']
    assert checked['reference']['words'] == group['words']
    request('/api/versions/' + copied['version_id'] + '/root-check', {'group_id': 'not-in-course', 'answers': [answer]}, status=400)
    for bad in ([], ['farm'] * 21, [123], ['x' * 81]):
        request('/api/versions/' + copied['version_id'] + '/root-check', {'group_id': group['id'], 'answers': bad}, status=400)
    same, _ = request('/api/lessons/' + copied['id'])
    assert same == copied

    version = '/api/versions/' + copied['version_id']
    request(version, {'notes': 'Before class', 'word_id': copied['words'][0]['id'], 'result': 'remembered',
                      'presentation_slide': 'review:1', 'cursor': 2, 'stage': 'practice'}, method='PATCH')
    request(version + '/attempts', {'answers': {str(w['id']): w['cloze_answer'] for w in copied['words']}}, status=201)
    completed, _ = request(version + '/complete', {})
    updated, _ = request(version, {'notes': 'Updated after class'}, method='PATCH')
    assert updated['read_only'] and updated['status'] == 'completed'
    assert {k: v for k, v in updated.items() if k != 'notes'} == {k: v for k, v in completed.items() if k != 'notes'}
    for bad in ({'notes': 'mixed update', 'stage': 'preview'}, {'notes': 123}, {'notes': 'x' * 5001}):
        request(version, bad, method='PATCH', status=400)
    unchanged, _ = request('/api/lessons/' + copied['id'])
    assert unchanged == updated

    # Add a second course with an old version and a pending draft. Copy latest course versions only.
    draft, _ = request('/api/preview', {'class_id': target_id, 'title': 'Second course'}, status=201)
    second, _ = request('/api/drafts/' + draft['id'] + '/confirm', {'revision': draft['revision']}, status=201)
    draft, _ = request('/api/preview', {'class_id': target_id, 'lesson_id': second['id'], 'title': 'Second latest'}, status=201)
    second, _ = request('/api/drafts/' + draft['id'] + '/confirm', {'revision': draft['revision']}, status=201)
    request('/api/preview', {'class_id': target_id, 'title': 'Unconfirmed'}, status=201)
    final, _ = request('/api/classes/' + target_id + '/copy', {'name': 'Reset class', 'request_id': uuid.uuid4().hex}, status=201)
    final_id = final['id']
    state, _ = request('/api/state?class_id=' + final_id)
    assert state['learned'] == 0 and len(state['lessons']) == 2
    originals = {updated['number']: updated, second['number']: second}
    for summary in state['lessons']:
        reset, _ = request('/api/lessons/' + summary['id'])
        original = originals[reset['number']]
        assert reset['status'] == 'active' and reset['completed_at'] is None and not reset['read_only']
        assert reset['version_number'] == 1 and len(reset['versions']) == 1
        assert reset['notes'] == '' and reset['draft'] == {} and reset['attempts'] == []
        assert reset['cursor'] == 0 and reset['stage'] == 'preview'
        assert 'presentation_slide' not in reset['config']
        assert reset['title'] == original['title']
        assert reset['materials'] == original['materials'] and reset['groups'] == original['groups']
        assert reset['config']['worksheets'] == original['config']['worksheets']
        assert [dict(w, result=None) for w in reset['words']] == [dict(w, result=None) for w in original['words']]
        assert all(w['result'] is None for w in reset['words'])
    empty_draft, _ = request('/api/drafts?class_id=' + final_id)
    assert empty_draft['draft'] is None
    # Source snapshots and independent media survive copies and their deletion.
    same, _ = request('/api/lessons/' + source['id'])
    assert same == source_before
    same, _ = request('/api/lessons/' + copied['id'])
    assert same == updated
    image = copied['words'][0]['images'][0]['src']
    pixels, _ = request(image, auth=False)
    for cid in (target_id, final_id):
        request('/api/classes/' + cid, method='DELETE')
    after, _ = request(image, auth=False)
    assert after == pixels
    request('/api/audio', {'text': 'farm'})
    # Empty classes may be copied as well.
    empty, _ = request('/api/classes', {'name': 'Empty source'}, status=201)
    clone, _ = request('/api/classes/' + empty['id'] + '/copy', {'name': 'Empty copy', 'request_id': uuid.uuid4().hex}, status=201)
    state, _ = request('/api/state?class_id=' + clone['id'])
    assert state['lessons'] == [] and state['learned'] == 0
    for cid in (empty['id'], clone['id']):
        request('/api/classes/' + cid, method='DELETE')
    print('PASS: completed notes stay editable; idempotent classroom copy resets latest courses and preserves shared assets; root examples use dictionary evidence')
