from mago import captions


def test_json3_clamps_overlapping_auto_captions():
    data = {"events": [
        {"tStartMs": 0, "dDurationMs": 5000, "segs": [{"utf8": "hello "}, {"utf8": "there"}]},
        {"tStartMs": 2000, "dDurationMs": 100, "segs": [{"utf8": "\n"}]},
        {"tStartMs": 2500, "dDurationMs": 3000, "segs": [{"utf8": "general &amp; kenobi"}]},
        {"tStartMs": 9000},
    ]}
    assert captions.from_json3(data) == [
        {"start": 0.0, "end": 2.5, "text": "hello there"},
        {"start": 2.5, "end": 5.5, "text": "general & kenobi"},
    ]


def test_vtt_drops_rolling_repeats_and_tags():
    vtt = """WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%
so <c>here</c> we are

1
00:00:03.000 --> 00:00:05.500
so here we are
in front of the elephants

01:02:03.250 --> 01:02:04.000
late line
"""
    assert captions.from_vtt(vtt) == [
        {"start": 1.0, "end": 3.0, "text": "so here we are"},
        {"start": 3.0, "end": 5.5, "text": "in front of the elephants"},
        {"start": 3723.25, "end": 3724.0, "text": "late line"},
    ]
