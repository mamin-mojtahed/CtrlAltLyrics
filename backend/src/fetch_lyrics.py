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
                        if item.get('syncedLyrics'):
                            return {'provider': 'LRCLIB (Synced)', 'lrc': item['syncedLyrics'], 'is_synced': True}
                    for item in data:
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

def fetch_spotify_session(title, artist, query, sp_dc_cookie, track_id=None):
    """Method 3a: Spotify Logged-in Session API using sp_dc cookie"""
    log_progress("Trying Spotify Session API...")
    if not sp_dc_cookie:
        return None
    try:
        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'App-Platform': 'WebPlayer'
        })
        session.cookies.set('sp_dc', sp_dc_cookie, domain='.spotify.com')
        
        token_res = session.get('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', timeout=5)
        if token_res.status_code != 200:
            return None
            
        token_data = token_res.json()
        access_token = token_data.get('accessToken')
        if not access_token:
            return None

        headers = {
            'Authorization': f'Bearer {access_token}',
            'App-Platform': 'WebPlayer',
            'User-Agent': 'Mozilla/5.0'
        }
        
        album_id = None
        if track_id:
            try:
                track_res = session.get(
                    f"https://api.spotify.com/v1/tracks/{track_id}",
                    headers=headers,
                    timeout=5
                )
                if track_res.status_code == 200:
                    album_id = track_res.json().get('album', {}).get('id')
            except Exception:
                pass

        if not album_id:
            search_term = query or f"{title} {artist}".strip()
            search_res = session.get(
                f"https://api.spotify.com/v1/search?q={urllib.parse.quote(search_term)}&type=track&limit=1",
                headers=headers,
                timeout=5
            )
            if search_res.status_code != 200:
                return None
                
            tracks = search_res.json().get('tracks', {}).get('items', [])
            if not tracks:
                return None
                
            track_id = tracks[0]['id']
            album_id = tracks[0]['album']['id']

        lyrics_res = session.get(
            f"https://spclient.wg.spotify.com/color-lyrics/v2/album/{album_id}/track/{track_id}?format=json",
            headers=headers,
            timeout=5
        )
        
        if lyrics_res.status_code == 200:
            data = lyrics_res.json()
            lines = data.get('lyrics', {}).get('lines', [])
            lrc_lines = []
            for l in lines:
                start_ms = int(l.get('startTimeMs', 0))
                mins = start_ms // 60000
                secs = (start_ms % 60000) / 1000.0
                words = l.get('words', '').strip()
                if words:
                    lrc_lines.append(f"[{mins:02d}:{secs:05.2f}] {words}")
            if lrc_lines:
                return {'provider': 'Spotify (Synced Session)', 'lrc': '\n'.join(lrc_lines), 'is_synced': True}
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
    sp_dc = args.spotify_cookie.strip() or os.environ.get("SPOTIFY_COOKIE_SP_DC", "")
    mxm_token = args.musixmatch_token.strip() or os.environ.get("MUSIXMATCH_USER_TOKEN", "")

    spotify_track_id = args.spotify_track_id.strip()

    result = None
    attempts = []

    if args.provider != "auto":
        p = args.provider.lower()
        if p == "lrclib":
            result = fetch_lrclib(title, artist, query)
        elif p == "musixmatch":
            result = fetch_syncedlyrics_provider(search_term, 'Musixmatch', mxm_token)
        elif p == "netease":
            result = fetch_syncedlyrics_provider(search_term, 'NetEase')
        elif p == "megalobiz":
            result = fetch_syncedlyrics_provider(search_term, 'Megalobiz')
        elif p == "spotify":
            result = fetch_spotify_session(title, artist, query, sp_dc, spotify_track_id)
        elif p == "genius":
            result = fetch_genius_or_plain(title, artist, query)
        
        if result:
            attempts.append({'provider': args.provider, 'status': 'success', 'detail': f"Loaded via {result['provider']}"})
        else:
            attempts.append({'provider': args.provider, 'status': 'failed', 'detail': 'No match found'})

    if not result:
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

        # 2. Musixmatch
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
