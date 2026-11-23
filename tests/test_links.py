import pytest

from mago.links import UnsupportedLink, detect


@pytest.mark.parametrize("raw, platform, kind, key", [
    ("https://www.youtube.com/watch?v=jNQXAC9IVRw", "youtube", "video", "jNQXAC9IVRw"),
    ("youtu.be/jNQXAC9IVRw?si=abc", "youtube", "video", "jNQXAC9IVRw"),
    ("https://m.youtube.com/watch?v=jNQXAC9IVRw&list=PLx&t=3s", "youtube", "video", "jNQXAC9IVRw"),
    ("https://youtube.com/shorts/jNQXAC9IVRw", "youtube", "video", "jNQXAC9IVRw"),
    ("https://www.youtube.com/live/jNQXAC9IVRw", "youtube", "video", "jNQXAC9IVRw"),
    ("https://www.youtube.com/@jawed", "youtube", "channel", "@jawed"),
    ("https://www.youtube.com/@jawed/videos", "youtube", "channel", "@jawed"),
    ("https://www.youtube.com/channel/UC4QobU6STFB0P71PMvOGN5A", "youtube", "channel", "channel/UC4QobU6STFB0P71PMvOGN5A"),
    ("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI", "youtube", "playlist", "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"),
    ("https://www.tiktok.com/@GoBigSystems", "tiktok", "profile", "@gobigsystems"),
    ("https://www.youtube.com/@CGPGrey", "youtube", "channel", "@cgpgrey"),
    ("https://www.youtube.com/@%E5%90%8D%E5%89%8D", "youtube", "channel", "@名前"),
    ("https://www.tiktok.com/@tiktok/video/7710348513128828191?lang=en", "tiktok", "video", "7710348513128828191"),
    ("https://vm.tiktok.com/ZMabcdef/", "tiktok", "video", "ZMabcdef"),
    ("https://www.tiktok.com/t/ZTabcdef/", "tiktok", "video", "ZTabcdef"),
])
def test_detect(raw, platform, kind, key):
    link = detect(raw)
    assert (link.platform, link.kind, link.key) == (platform, kind, key)


def test_same_video_gets_one_canonical_url():
    assert detect("youtu.be/jNQXAC9IVRw").url == detect("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=5").url
    assert detect("https://www.youtube.com/@jawed/shorts").url == "https://www.youtube.com/@jawed"


@pytest.mark.parametrize("raw", ["", "hello", "https://vimeo.com/1234", "https://www.youtube.com/",
                                 "https://www.youtube.com/watch?v=short", "https://www.tiktok.com/foryou",
                                 "https://www.youtube.com/playlist"])
def test_rejects(raw):
    with pytest.raises(UnsupportedLink):
        detect(raw)
