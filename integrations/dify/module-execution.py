import json


def main(execution_json: str) -> dict:
    data = json.loads(execution_json)
    assert data.get('schema') == 1, 'invalid schema'
    for key in ['run_id', 'module_id']:
        assert isinstance(data.get(key), str) and data[key], 'missing identity'
    ids = data.get('case_ids')
    phase = data.get('phase')
    if phase == 'web-package-check':
        assert isinstance(ids, list) and 1 <= len(ids) <= 200, 'invalid web module size'
        assert isinstance(data.get('package_digest'), str) and len(data['package_digest']) == 64, 'invalid package digest'
        counts = data.get('status_counts')
        assert isinstance(counts, dict) and all(isinstance(v, int) and v >= 0 for v in counts.values()), 'invalid status counts'
        assert sum(counts.values()) == len(ids), 'status counts do not match case ids'
        assert len(set(ids)) == len(ids) and all(isinstance(v, str) and v for v in ids), 'duplicate or invalid case ids'
        result = {key: data[key] for key in ['schema', 'phase', 'run_id', 'module_id', 'package_digest', 'case_ids', 'status_counts']}
        result['action'] = 'check-approved-web-package'
        return {'result': json.dumps(result, ensure_ascii=False)}
    for key in ['plan_digest', 'suite_digest']:
        assert isinstance(data.get(key), str) and data[key], 'missing identity'
    assert isinstance(ids, list) and 1 <= len(ids) <= 20, 'invalid module size'
    assert len(set(ids)) == len(ids) and all(isinstance(v, str) for v in ids), 'duplicate case ids'
    result = {key: data[key] for key in ['schema', 'run_id', 'module_id', 'plan_digest', 'suite_digest', 'case_ids']}
    result['phase'] = phase
    if phase == 'dispatch':
        # The local runner independently checks this exact manifest against an
        # approved suite; the cloud never receives credentials or request URLs.
        assert 'results' not in data, 'dispatch cannot contain results'
        result['action'] = 'execute-approved-suite'
    elif phase == 'report':
        rows = data.get('results')
        assert isinstance(rows, list) and len(rows) == len(ids), 'incomplete results'
        assert [r.get('case_id') for r in rows] == ids, 'results must match fixed order'
        counts = {'passed': 0, 'failed': 0, 'blocked': 0, 'error': 0, 'not_executed': 0}
        for row in rows:
            assert row.get('status') in counts, 'invalid execution status'
            counts[row['status']] += 1
        result['counts'] = counts
    else:
        raise ValueError('unsupported phase')
    return {'result': json.dumps(result, ensure_ascii=False)}
