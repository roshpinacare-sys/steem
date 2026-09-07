#!/usr/bin/env python3
"""Live experiment: determine required signature authority for every Steem op.
Uses condenser_api.get_potential_signatures on a reference account (justyy),
then matches returned pubkeys against the account's owner/active/posting authorities.
Read-only: no signing, no broadcast.
"""
import json, urllib.request, time

NODE = 'https://api.steemit.com'

def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode()
    req = urllib.request.Request(NODE, data=body, headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=20))

acc = rpc('condenser_api.get_accounts', [['justyy']])['result'][0]
key2lvl = {}
for lvl in ('owner', 'active', 'posting'):
    for k, _th in acc[lvl]['key_auths']:
        key2lvl[k] = lvl
print(f"reference account: justyy | owner:{len(acc['owner']['key_auths'])} active:{len(acc['active']['key_auths'])} posting:{len(acc['posting']['key_auths'])}", flush=True)

exp = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() + 3000))
A = 'justyy'

OPS = {
    'vote': {'voter': A, 'author': 'x', 'permlink': 'p', 'weight': 100},
    'comment': {'parent_author': '', 'parent_permlink': 'test', 'author': A, 'permlink': 'p2', 'title': '', 'body': 'b', 'json_metadata': '{}'},
    'delete_comment': {'author': A, 'permlink': 'p2'},
    'comment_options': {'author': A, 'permlink': 'p2', 'max_accepted_payout': '1000000.000 SBD', 'percent_steem_dollars': 10000, 'allow_votes': True, 'allow_curation_rewards': True, 'extensions': []},
    'claim_reward_balance': {'account': A, 'reward_steem': '0.000 STEEM', 'reward_sbd': '0.000 SBD', 'reward_vests': '0.000000 VESTS'},
    'custom_json:posting': {'required_auths': [], 'required_posting_auths': [A], 'id': 'dw-test', 'json': '{}'},
    'account_update2': {'account': A, 'posting_json_metadata': '{"profile":{"name":"x"}}'},
    'transfer': {'from': A, 'to': 'x', 'amount': '0.001 STEEM', 'memo': ''},
    'convert': {'owner': A, 'requestid': 1, 'amount': '0.001 SBD'},
    'limit_order_create': {'owner': A, 'orderid': 1, 'amount_to_sell': '0.001 SBD', 'min_to_receive': '0.001 STEEM', 'fill_or_kill': False, 'expiration': exp},
    'limit_order_cancel': {'owner': A, 'orderid': 1},
    'transfer_to_savings': {'from': A, 'to': A, 'amount': '0.001 STEEM', 'memo': ''},
    'transfer_from_savings': {'from': A, 'request_id': 1, 'to': A, 'amount': '0.001 STEEM', 'memo': ''},
    'cancel_transfer_from_savings': {'from': A, 'request_id': 1},
    'transfer_to_vesting': {'from': A, 'to': '', 'amount': '0.001 STEEM'},
    'withdraw_vesting': {'account': A, 'vesting_shares': '0.000000 VESTS'},
    'delegate_vesting_shares': {'delegator': A, 'delegatee': 'x', 'vesting_shares': '0.000000 VESTS'},
    'escrow_transfer': {'from': A, 'to': 'x', 'agent': 'y', 'escrow_id': 1, 'sbd_amount': '0.000 SBD', 'steem_amount': '0.001 STEEM', 'fee': '0.001 STEEM', 'ratification_deadline': exp, 'escrow_expiration': exp, 'json_meta': '{}'},
    'escrow_approve': {'from': 'x', 'to': 'y', 'agent': A, 'who': A, 'escrow_id': 1, 'approve': True},
    'escrow_release': {'from': 'x', 'to': 'y', 'agent': A, 'who': A, 'receiver': 'y', 'escrow_id': 1, 'sbd_amount': '0.000 SBD', 'steem_amount': '0.001 STEEM'},
    'escrow_dispute': {'from': 'x', 'to': 'y', 'agent': A, 'who': A, 'escrow_id': 1},
    'create_proposal': {'creator': A, 'receiver': A, 'start_date': exp, 'end_date': exp, 'daily_pay': '0.000 SBD', 'subject': 's', 'permlink': 'p'},
    'update_proposal_votes': {'voter': A, 'proposal_ids': [0], 'approve': True, 'extensions': []},
    'remove_proposal': {'proposal_owner': A, 'proposal_ids': [0], 'extensions': []},
    'custom_json:active': {'required_auths': [A], 'required_posting_auths': [], 'id': 'dw-test2', 'json': '{}'},
    'claim_account': {'creator': A, 'fee': '0.000 STEEM', 'extensions': []},
    'account_witness_vote': {'account': A, 'witness': 'x', 'approve': True},
    'account_witness_proxy': {'account': A, 'proxy': ''},
    'witness_update': {'owner': A, 'url': '', 'block_signing_key': 'STM1111111111111111111111111111111114T1Anm', 'props': {'account_creation_fee': '0.000 STEEM', 'maximum_block_size': 65536, 'sbd_interest_rate': 0}, 'fee': '0.000 STEEM'},
    'feed_publish': {'publisher': A, 'exchange_rate': {'base': '1.000 SBD', 'quote': '1.000 STEEM'}},
    'witness_set_properties': {'owner': A, 'props': [], 'extensions': []},
    'decline_voting_rights': {'account': A, 'decline': True},
}

results = {}
for name, op in OPS.items():
    trx = {"ref_block_num": 0, "ref_block_prefix": 0, "expiration": exp, "operations": [[name.split(':')[0], op]], "extensions": []}
    try:
        r = rpc('condenser_api.get_potential_signatures', [trx])['result']
        lvls = sorted({key2lvl[k] for k in r if k in key2lvl})
        unk = len([k for k in r if k not in key2lvl])
        results[name] = {'levels': lvls, 'unknown_keys': unk, 'n_keys': len(r)}
        print(f"{name:28s} -> {','.join(lvls) if lvls else '?':18s} (keys={len(r)}, unknown={unk})", flush=True)
    except Exception as e:
        results[name] = {'error': str(e)[:120]}
        print(f"{name:28s} -> ERR {str(e)[:100]}", flush=True)
    time.sleep(0.05)

with open('/home/z/my-project/scripts/key_authority_results.json', 'w') as f:
    json.dump(results, f, ensure_ascii=False, indent=1)
print("\nsaved -> scripts/key_authority_results.json")
