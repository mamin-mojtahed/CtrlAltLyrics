#!/usr/bin/env python3
import sys
import os
import json
import re
import argparse
import urllib.parse
import urllib.request
import requests

def parse_args():
    parser = argparse.ArgumentParser(description="Multi-provider lyrics fetcher")
    parser.add_argument("--title", required=True, help="Song title")
    parser.add_argument("--artist", default="", help="Artist name")
    parser.add_argument("--query", default="", help="Full search query")
    parser.add_argument("--spotify_track_id", default="", help="Spotify Track ID")
    parser.add_argument("--spotify_cookie", default="", help="Spotify sp_dc cookie")
    parser.add_argument("--musixmatch_token", default="", help="Musixmatch user token")
    parser.add_argument("--provider", default="auto", help="Provider choice: auto, lrclib, musixmatch, netease, megalobiz, spotify, genius")
    return parser.parse_args()

def log_progress(msg):
    print(f"PROGRESS: {msg}", flush=True)

def normalize_title(t):
    if not t:
        return ""
    # Strip text in parentheses/brackets e.g. (feat. ...), (Remastered), etc.
    t = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', t)
    # Remove punctuation, keep letters and numbers (including Persian/Arabic Unicode)
    t = re.sub(r'[^\w\s\u0600-\u06FF]', ' ', t)
    return ' '.join(t.lower().split())

def is_title_match(target_title, candidate_title):
    t1 = normalize_title(target_title)
    t2 = normalize_title(candidate_title)
    if not t1 or not t2:
        return False
    if t1 == t2:
        return True
    
    w1 = set(t1.split())
    w2 = set(t2.split())
    if not w1 or not w2:
        return False
    
    # Candidate must contain all words of the target title
    if w1.issubset(w2):
        return True
    
    import difflib
    # For spelling variations (e.g. daryaa vs darya)
    if difflib.SequenceMatcher(None, t1, t2).ratio() >= 0.85:
        return True
    
    return False

def normalize_artist(a):
    if not a:
        return ""
    a = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', a)
    a = re.sub(r'[^\w\s\u0600-\u06FF]', ' ', a)
    return ' '.join(a.lower().split())

def is_artist_match(target_artist, candidate_artists):
    if not target_artist:
        return True
    t_art = normalize_artist(target_artist)
    if not t_art:
        return True

    # Split target artists by common delimiters
    target_subs = [normalize_artist(p) for p in re.split(r",|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\band\b", target_artist, flags=re.I) if normalize_artist(p)] or [t_art]

    cand_list = []
    if isinstance(candidate_artists, str):
        candidate_artists = [candidate_artists]
    for ca in candidate_artists:
        if not ca:
            continue
        subs = [normalize_artist(p) for p in re.split(r",|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\band\b", ca, flags=re.I) if normalize_artist(p)]
        cand_list.extend(subs or [normalize_artist(ca)])

    if not cand_list:
        return False

    import difflib
    for t_sub in target_subs:
        w_target = set(t_sub.split())
        for c in cand_list:
            if c == t_sub:
                return True
            if difflib.SequenceMatcher(None, t_sub, c).ratio() >= 0.85:
                return True
            w_c = set(c.split())
            if len(w_target) > 1 and len(w_c) > 1:
                if w_target == w_c or w_target.issubset(w_c) or w_c.issubset(w_target):
                    return True

    return False

def fetch_lrclib(title, artist, query):
    """Method 1: LRCLIB direct API & search"""
    log_progress("Trying LRCLIB (Exact)...")
    if title and artist:
        try:
            url = f"https://lrclib.net/api/get?track_name={urllib.parse.quote(title)}&artist_name={urllib.parse.quote(artist)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'KaraokePlayer/1.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode())
                if data.get('syncedLyrics'):
                    return {'provider': 'LRCLIB (Synced)', 'lrc': data['syncedLyrics'], 'is_synced': True}
                elif data.get('plainLyrics'):
                    return {'provider': 'LRCLIB (Plain)', 'lrc': data['plainLyrics'], 'is_synced': False}
        except Exception:
            pass

    log_progress("Trying LRCLIB (Search)...")
    search_str = query or f"{title} {artist}".strip()
    if search_str:
        try:
            url = f"https://lrclib.net/api/search?q={urllib.parse.quote(search_str)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'KaraokePlayer/1.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode())
                if isinstance(data, list) and len(data) > 0:
                    for item in data:
                        t_match = is_title_match(title, item.get('trackName', ''))
                        a_match = is_artist_match(artist, item.get('artistName', ''))
                        if t_match and a_match:
                            if item.get('syncedLyrics'):
                                return {'provider': 'LRCLIB (Synced)', 'lrc': item['syncedLyrics'], 'is_synced': True}
                    for item in data:
                        t_match = is_title_match(title, item.get('trackName', ''))
                        a_match = is_artist_match(artist, item.get('artistName', ''))
                        if t_match and a_match:
                            if item.get('plainLyrics'):
                                return {'provider': 'LRCLIB (Plain)', 'lrc': item['plainLyrics'], 'is_synced': False}
        except Exception:
            pass

    return None

def fetch_syncedlyrics_provider(search_term, provider_name, musixmatch_token=None):
    """Helper using syncedlyrics python package for specific provider"""
    log_progress(f"Trying {provider_name}...")
    try:
        import syncedlyrics
        if musixmatch_token and provider_name == 'Musixmatch':
            try:
                from syncedlyrics.utils import get_cache_path
                token_path = get_cache_path("syncedlyrics", False) / "musixmatch_token.json"
                token_path.parent.mkdir(parents=True, exist_ok=True)
                with open(token_path, "w") as tf:
                    json.dump({"token": musixmatch_token, "expiration_time": 9999999999}, tf)
            except Exception:
                pass

        lrc = syncedlyrics.search(search_term, providers=[provider_name], synced_only=True)
        if lrc:
            return {'provider': f'{provider_name} (Synced)', 'lrc': lrc, 'is_synced': True}
    except Exception as e:
        sys.stderr.write(f"Syncedlyrics error for {provider_name}: {e}\n")
    return None

def get_spotify_web_token(sp_dc_cookie):
    """Exchanges sp_dc cookie for a WebPlayer accessToken using Spotify's token endpoint with TOTP validation."""
    if not sp_dc_cookie:
        return None

    client = requests
    try:
        from curl_cffi import requests as cffi_requests
        client = cffi_requests
    except Exception:
        pass

    # 1. Modern open.spotify.com/api/token with TOTP
    try:
        totp = None
        version = 61
        try:
            from spotapi.client import generate_totp
            totp, version = generate_totp()
        except Exception:
            pass

        params = {
            'reason': 'transport',
            'productType': 'web-player',
        }
        if totp:
            params['totp'] = totp
            params['totpVer'] = str(version)
            params['totpServer'] = totp

        headers = {
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'App-Platform': 'WebPlayer',
            'Referer': 'https://open.spotify.com/',
            'Origin': 'https://open.spotify.com',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        }
        cookies = {'sp_dc': sp_dc_cookie}

        kwargs = {'params': params, 'headers': headers, 'cookies': cookies, 'timeout': 8}
        if hasattr(client, 'Session') and client != requests:
            kwargs['impersonate'] = 'chrome'

        resp = client.get('https://open.spotify.com/api/token', **kwargs)
        if resp.status_code == 200:
            token = resp.json().get('accessToken')
            if token:
                return token
    except Exception as e:
        sys.stderr.write(f"Spotify token API error: {e}\n")

    # 2. Fallback: legacy get_access_token endpoint
    try:
        legacy_url = 'https://open.spotify.com/get_access_token?reason=transport&productType=web-player'
        headers = {
            'Accept': 'application/json',
            'App-Platform': 'WebPlayer',
            'Referer': 'https://open.spotify.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        }
        kwargs = {'headers': headers, 'cookies': {'sp_dc': sp_dc_cookie}, 'timeout': 8}
        if hasattr(client, 'Session') and client != requests:
            kwargs['impersonate'] = 'chrome'
        resp = client.get(legacy_url, **kwargs)
        if resp.status_code == 200:
            token = resp.json().get('accessToken')
            if token:
                return token
    except Exception as e:
        sys.stderr.write(f"Spotify legacy token error: {e}\n")

    return None

def load_settings():
    """Loads configuration settings such as spotify_cookie from backend/data/settings.json."""
    try:
        settings_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'settings.json')
        if os.path.exists(settings_path):
            with open(settings_path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def search_spotify_track_ids(title, artist, query, access_token=None):
    """Finds Spotify track ID candidates using SpotAPI Public search or Web API."""
    search_str = query or f"{title} {artist}".strip()
    candidates = []

    # Method A: Try spotapi Public search (avoids api.spotify.com rate limits)
    try:
        from spotapi.public import Public
        p = Public()
        for page in p.song_search(search_str):
            for item in page:
                d = item.get('item', {}).get('data', {})
                tid = d.get('id')
                cand_name = d.get('name') or ''
                cand_artists = [a.get('profile', {}).get('name') for a in d.get('artists', {}).get('items', []) if a.get('profile', {}).get('name')]
                if tid and is_title_match(title, cand_name) and is_artist_match(artist, cand_artists):
                    if tid not in candidates:
                        candidates.append(tid)
                if len(candidates) >= 5:
                    break
            break
    except Exception as e:
        sys.stderr.write(f"SpotAPI public search error: {e}\n")

    # Method B: Try official search with web token
    if not candidates and access_token:
        try:
            client = requests
            try:
                from curl_cffi import requests as cffi_requests
                client = cffi_requests
            except Exception:
                pass

            headers = {
                'Authorization': f'Bearer {access_token}',
                'Accept': 'application/json',
                'App-Platform': 'WebPlayer',
                'Referer': 'https://open.spotify.com/',
            }
            url = f"https://api.spotify.com/v1/search?q={urllib.parse.quote(search_str)}&type=track&limit=5"
            kwargs = {'headers': headers, 'timeout': 5}
            if hasattr(client, 'Session') and client != requests:
                kwargs['impersonate'] = 'chrome'
            sr = client.get(url, **kwargs)
            if sr.status_code == 200:
                tracks = sr.json().get('tracks', {}).get('items', [])
                for t in tracks:
                    tid = t.get('id')
                    cand_name = t.get('name') or ''
                    cand_artists = [a.get('name') for a in t.get('artists', []) if a.get('name')]
                    if tid and is_title_match(title, cand_name) and is_artist_match(artist, cand_artists):
                        if tid not in candidates:
                            candidates.append(tid)
        except Exception:
            pass

    return candidates

def fetch_spotify_color_lyrics(track_id, access_token):
    """Fetches color-lyrics from spclient.wg.spotify.com for track_id."""
    if not track_id or not access_token:
        return None

    client = requests
    try:
        from curl_cffi import requests as cffi_requests
        client = cffi_requests
    except Exception:
        pass

    headers = {
        'Authorization': f'Bearer {access_token}',
        'App-Platform': 'WebPlayer',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
    }

    url = f"https://spclient.wg.spotify.com/color-lyrics/v2/track/{track_id}?format=json&vocalRemoval=false"
    kwargs = {'headers': headers, 'timeout': 8}
    if hasattr(client, 'Session') and client != requests:
        kwargs['impersonate'] = 'chrome'

    try:
        lr = client.get(url, **kwargs)
        if lr.status_code == 200:
            data = lr.json()
            lines = data.get('lyrics', {}).get('lines', [])
            sync_type = data.get('lyrics', {}).get('syncType', '')
            is_synced = (sync_type == 'LINE_SYNCED' or sync_type == 'SYLLABLE_SYNCED')

            lrc_lines = []
            for l in lines:
                start_ms = int(l.get('startTimeMs', 0))
                mins = start_ms // 60000
                secs = (start_ms % 60000) / 1000.0
                words = l.get('words', '').strip()
                if words:
                    lrc_lines.append(f"[{mins:02d}:{secs:05.2f}] {words}")
            if lrc_lines:
                return {
                    'provider': 'Spotify (Color Lyrics)',
                    'lrc': '\n'.join(lrc_lines),
                    'is_synced': is_synced,
                    'spotify_track_id': track_id
                }
    except Exception as e:
        sys.stderr.write(f"Color-lyrics error: {e}\n")

    return None

def fetch_spotify_session(title, artist, query, sp_dc_cookie, track_id=None):
    """Method 3a: Spotify Logged-in Session API using sp_dc cookie and color-lyrics"""
    log_progress("Trying Spotify Color-Lyrics API...")
    if not sp_dc_cookie:
        return None

    try:
        access_token = get_spotify_web_token(sp_dc_cookie)
        if not access_token:
            log_progress("Spotify session token failed; checking fallback...")
            return None

        candidates = []
        if track_id:
            candidates.append(track_id)

        searched = search_spotify_track_ids(title, artist, query, access_token)
        for tid in searched:
            if tid not in candidates:
                candidates.append(tid)

        for tid in candidates:
            result = fetch_spotify_color_lyrics(tid, access_token)
            if result:
                return result
    except Exception as e:
        sys.stderr.write(f"Spotify session error: {e}\n")

    return None

def fetch_genius_or_plain(title, artist, query):
    """Method 3b: Genius / Unsynced Plain Text Fallback"""
    log_progress("Trying Genius (Fallback)...")
    search_term = query or f"{title} {artist}".strip()
    try:
        import syncedlyrics
        lrc = syncedlyrics.search(search_term, providers=['Genius'])
        if lrc:
            return {'provider': 'Genius (Fallback)', 'lrc': lrc, 'is_synced': False}
    except Exception:
        pass

    log_progress("Trying Plain Text Search (Fallback)...")
    try:
        import syncedlyrics
        lrc_plain = syncedlyrics.search(search_term, plain_only=True)
        if lrc_plain:
            return {'provider': 'Plain Text (Fallback)', 'lrc': lrc_plain, 'is_synced': False}
    except Exception:
        pass

    return None

def format_plain_as_lrc(plain_text):
    """Converts un-timestamped text lines into estimated LRC lines spaced ~4 seconds apart"""
    lines = [line.strip() for line in plain_text.split('\n') if line.strip()]
    lrc_lines = []
    current_sec = 4.0
    for line in lines:
        mins = int(current_sec // 60)
        secs = current_sec % 60
        lrc_lines.append(f"[{mins:02d}:{secs:05.2f}] {line}")
        current_sec += 4.0
    return '\n'.join(lrc_lines)

def main():
    args = parse_args()
    title = args.title.strip()
    artist = args.artist.strip()
    query = args.query.strip()
    search_term = query or f"{title} {artist}".strip()

    settings = load_settings()
    sp_dc = args.spotify_cookie.strip() or os.environ.get("SPOTIFY_COOKIE_SP_DC", "") or settings.get("spotify_cookie", "").strip()
    mxm_token = args.musixmatch_token.strip() or os.environ.get("MUSIXMATCH_USER_TOKEN", "") or settings.get("musixmatch_token", "").strip()

    spotify_track_id = args.spotify_track_id.strip()

    result = None
    attempts = []

    if args.provider != "auto":
        p = args.provider.lower()
        if p == "lrclib":
            result = fetch_lrclib(title, artist, query)
            if result:
                attempts.append({'provider': args.provider, 'status': 'success', 'detail': f"Loaded via {result['provider']}"})
            else:
                attempts.append({'provider': args.provider, 'status': 'failed', 'detail': 'No match found'})
        elif p == "musixmatch":
            result = fetch_syncedlyrics_provider(search_term, 'Musixmatch', mxm_token)
            if result:
                attempts.append({'provider': args.provider, 'status': 'success', 'detail': f"Loaded via {result['provider']}"})
            else:
                attempts.append({'provider': args.provider, 'status': 'failed', 'detail': 'No synced lyrics found on Musixmatch'})
        elif p == "netease":
            result = fetch_syncedlyrics_provider(search_term, 'NetEase')
            if result:
                attempts.append({'provider': args.provider, 'status': 'success', 'detail': f"Loaded via {result['provider']}"})
            else:
                attempts.append({'provider': args.provider, 'status': 'failed', 'detail': 'No synced lyrics found on NetEase'})
        elif p == "megalobiz":
            result = fetch_syncedlyrics_provider(search_term, 'Megalobiz')
            if result:
                attempts.append({'provider': args.provider, 'status': 'success', 'detail': f"Loaded via {result['provider']}"})
            else:
                attempts.append({'provider': args.provider, 'status': 'failed', 'detail': 'No synced lyrics found on Megalobiz'})
        elif p == "deezer":
            result = fetch_syncedlyrics_provider(search_term, 'Deezer')
            if result:
                attempts.append({'provider': args.provider, 'status': 'success', 'detail': f"Loaded via {result['provider']}"})
            else:
                attempts.append({'provider': args.provider, 'status': 'failed', 'detail': 'No synced lyrics found on Deezer'})
        elif p == "lyricsify":
            result = fetch_syncedlyrics_provider(search_term, 'Lyricsify')
            if result:
                attempts.append({'provider': args.provider, 'status': 'success', 'detail': f"Loaded via {result['provider']}"})
            else:
                attempts.append({'provider': args.provider, 'status': 'failed', 'detail': 'No synced lyrics found on Lyricsify'})
        elif p == "spotify":
            # 1. Native Spotify Color-Lyrics via sp_dc session
            if sp_dc:
                res_sp = fetch_spotify_session(title, artist, query, sp_dc, spotify_track_id)
                if res_sp:
                    attempts.append({'provider': 'Spotify (Color Lyrics)', 'status': 'success', 'detail': 'Loaded native line-synced lyrics from Spotify'})
                    result = res_sp
                else:
                    attempts.append({'provider': 'Spotify (Color Lyrics)', 'status': 'failed', 'detail': 'Track lacks color-lyrics on Spotify; falling back to Spotify partner'})
            else:
                attempts.append({'provider': 'Spotify (Color Lyrics)', 'status': 'skipped', 'detail': 'No sp_dc session cookie configured; using Spotify official partner fallback'})

            # 2. Universal Spotify Partner Fallback: Spotify's official lyrics partner is Musixmatch
            if not result:
                res_mxm = fetch_syncedlyrics_provider(search_term, 'Musixmatch', mxm_token)
                if res_mxm:
                    attempts.append({'provider': 'Musixmatch (Spotify Partner Fallback)', 'status': 'success', 'detail': 'Found synced lyrics via Musixmatch'})
                    result = res_mxm
                else:
                    attempts.append({'provider': 'Musixmatch (Spotify Partner Fallback)', 'status': 'failed', 'detail': 'No synced match on Musixmatch'})

            # 3. LRCLIB Synced / Plain Fallback
            if not result:
                res_lrc = fetch_lrclib(title, artist, query)
                if res_lrc:
                    attempts.append({'provider': 'LRCLIB (Fallback)', 'status': 'success', 'detail': f"Found {'synced' if res_lrc.get('is_synced') else 'plain'} lyrics via LRCLIB"})
                    result = res_lrc
                else:
                    attempts.append({'provider': 'LRCLIB (Fallback)', 'status': 'failed', 'detail': 'No match found on LRCLIB'})

            # 4. Genius Plain Text Fallback
            if not result:
                res_genius = fetch_genius_or_plain(title, artist, query)
                if res_genius:
                    attempts.append({'provider': 'Genius / Plain (Fallback)', 'status': 'success', 'detail': 'Found plain text fallback'})
                    result = res_genius
                else:
                    attempts.append({'provider': 'Genius / Plain (Fallback)', 'status': 'failed', 'detail': 'No plain lyrics found'})

        elif p == "genius":
            result = fetch_genius_or_plain(title, artist, query)
            if result:
                attempts.append({'provider': args.provider, 'status': 'success', 'detail': f"Loaded via {result['provider']}"})
            else:
                attempts.append({'provider': args.provider, 'status': 'failed', 'detail': 'No match found'})
    else:
        # Full sequential fallback chain with attempts tracking
        # 1. LRCLIB
        res_lrclib = fetch_lrclib(title, artist, query)
        if res_lrclib and res_lrclib.get('is_synced'):
            attempts.append({'provider': 'LRCLIB', 'status': 'success', 'detail': 'Found synced LRC'})
            result = res_lrclib
        elif res_lrclib:
            attempts.append({'provider': 'LRCLIB', 'status': 'partial', 'detail': 'Found plain text (no sync)'})
            result = res_lrclib
        else:
            attempts.append({'provider': 'LRCLIB', 'status': 'failed', 'detail': 'No match found'})

        # 2. Spotify Session (Color Lyrics)
        if not result or not result.get('is_synced'):
            if sp_dc:
                res_sp = fetch_spotify_session(title, artist, query, sp_dc, spotify_track_id)
                if res_sp:
                    attempts.append({'provider': 'Spotify Session', 'status': 'success', 'detail': 'Found Spotify color-lyrics'})
                    result = res_sp
                else:
                    attempts.append({'provider': 'Spotify Session', 'status': 'failed', 'detail': 'No color-lyrics found'})
            else:
                attempts.append({'provider': 'Spotify Session', 'status': 'skipped', 'detail': 'No sp_dc session cookie configured'})
        else:
            attempts.append({'provider': 'Spotify Session', 'status': 'skipped', 'detail': 'Skipped (synced lyrics already found)'})

        # 3. Musixmatch
        if not result or not result.get('is_synced'):
            res_mxm = fetch_syncedlyrics_provider(search_term, 'Musixmatch', mxm_token)
            if res_mxm:
                attempts.append({'provider': 'Musixmatch', 'status': 'success', 'detail': 'Found synced LRC'})
                result = res_mxm
            else:
                attempts.append({'provider': 'Musixmatch', 'status': 'failed', 'detail': 'No synced match found'})
        else:
            attempts.append({'provider': 'Musixmatch', 'status': 'skipped', 'detail': 'Skipped (synced lyrics already found)'})

        # 3. NetEase
        if not result or not result.get('is_synced'):
            res_netease = fetch_syncedlyrics_provider(search_term, 'NetEase')
            if res_netease:
                attempts.append({'provider': 'NetEase', 'status': 'success', 'detail': 'Found synced LRC'})
                result = res_netease
            else:
                attempts.append({'provider': 'NetEase', 'status': 'failed', 'detail': 'No synced match found'})
        else:
            attempts.append({'provider': 'NetEase', 'status': 'skipped', 'detail': 'Skipped (synced lyrics already found)'})

        # 4. Megalobiz
        if not result or not result.get('is_synced'):
            res_megalobiz = fetch_syncedlyrics_provider(search_term, 'Megalobiz')
            if res_megalobiz:
                attempts.append({'provider': 'Megalobiz', 'status': 'success', 'detail': 'Found synced LRC'})
                result = res_megalobiz
            else:
                attempts.append({'provider': 'Megalobiz', 'status': 'failed', 'detail': 'No synced match found'})
        else:
            attempts.append({'provider': 'Megalobiz', 'status': 'skipped', 'detail': 'Skipped (synced lyrics already found)'})

        # 5. Spotify Session
        if not result or not result.get('is_synced'):
            if sp_dc:
                res_sp = fetch_spotify_session(title, artist, query, sp_dc, spotify_track_id)
                if res_sp:
                    attempts.append({'provider': 'Spotify Session', 'status': 'success', 'detail': 'Found Spotify color-lyrics'})
                    result = res_sp
                else:
                    attempts.append({'provider': 'Spotify Session', 'status': 'failed', 'detail': 'No color-lyrics found'})
            else:
                attempts.append({'provider': 'Spotify Session', 'status': 'skipped', 'detail': 'No sp_dc session cookie configured'})
        else:
            attempts.append({'provider': 'Spotify Session', 'status': 'skipped', 'detail': 'Skipped (synced lyrics already found)'})

        # 6. Genius / Plain Text Fallback
        if not result:
            res_genius = fetch_genius_or_plain(title, artist, query)
            if res_genius:
                attempts.append({'provider': 'Genius / Plain Text', 'status': 'success', 'detail': 'Found plain text fallback'})
                result = res_genius
            else:
                attempts.append({'provider': 'Genius / Plain Text', 'status': 'failed', 'detail': 'No plain text found'})
        else:
            attempts.append({'provider': 'Genius / Plain Text', 'status': 'skipped', 'detail': 'Skipped (synced lyrics already found)'})

    if result:
        if not re.search(r'\[\d{2}:\d{2}', result['lrc']):
            result['lrc'] = format_plain_as_lrc(result['lrc'])
        print(json.dumps({'success': True, 'attempts': attempts, **result}), flush=True)
    else:
        print(json.dumps({'success': False, 'attempts': attempts, 'error': 'No lyrics found across any provider.'}), flush=True)

if __name__ == '__main__':
    main()
