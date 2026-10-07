#!/usr/bin/env python3
import sqlite3
import json
import os
import re
import datetime
import pathlib

OPENCODE_DB = "/home/zen/.local/share/opencode/opencode.db"
HOMES = [
    "/home/zen/.paseo",
    "/home/zen/.zencode",
    "/home/zen/zencode/paseo/.dev/paseo-home"
]

WORKSPACE_MAPPINGS = {
    "/home/zen/gray-doom": "wks_zencode_gray_doom",
    "/home/zen/VerticalRisk": "wks_zencode_verticalrisk_grc",
    "/home/zen/insilos-release-work": "wks_zencode_insilos_odoo",
    "/home/zen/hermes-agent": "wks_zencode_hermes_agent",
    "/home/zen/zencode/paseo": "wks_zencode_zencode_core",
    "/home/zen": "wks_zencode_zen_system",
    "/home/zen/Downloads": "wks_zencode_zen_system",
    "/home/zen/demo": "wks_zencode_zen_system",
    "/home/zen/cos": "wks_zencode_zen_system",
}

def project_dir_name_from_cwd(cwd: str) -> str:
    # Match TypeScript projectDirNameFromCwd
    clean = cwd.replace("\\", "/").rstrip("/")
    if clean.startswith("/"):
        clean = clean[1:]
    if not clean:
        return "root"
    return "home-" + clean.replace("/", "-") if not clean.startswith("home") else clean.replace("/", "-")

def sync_opencode_sessions():
    if not os.path.exists(OPENCODE_DB):
        print(f"OpenCode DB not found at {OPENCODE_DB}")
        return

    conn = sqlite3.connect(OPENCODE_DB)
    cur = conn.cursor()
    cur.execute("""
        SELECT id, title, directory, time_created, time_updated, time_archived, model 
        FROM session 
        ORDER BY time_updated DESC
    """)
    sessions = cur.fetchall()

    print(f"Found {len(sessions)} sessions in {OPENCODE_DB}")

    synced_count = 0
    for row in sessions:
        sid, title, directory, t_created, t_updated, t_archived, model = row
        cwd = directory or "/home/zen"

        # Check for better title if "New session - "
        if title.startswith("New session - ") or not title:
            cur.execute("""
                SELECT data FROM part 
                WHERE session_id = ? AND data LIKE '%"type":"text"%'
                ORDER BY time_created ASC LIMIT 1
            """, (sid,))
            part_row = cur.fetchone()
            if part_row:
                try:
                    pdata = json.loads(part_row[0])
                    first_text = pdata.get("text", "").strip().strip('"\'')
                    if first_text and len(first_text) > 2:
                        # Clean title to first 80 chars
                        title = first_text[:80].replace("\n", " ").strip()
                except Exception:
                    pass

        created_iso = datetime.datetime.fromtimestamp(t_created/1000).isoformat() + "Z" if t_created else datetime.datetime.utcnow().isoformat() + "Z"
        updated_iso = datetime.datetime.fromtimestamp(t_updated/1000).isoformat() + "Z" if t_updated else created_iso
        archived_iso = (datetime.datetime.fromtimestamp(t_archived/1000).isoformat() + "Z") if t_archived else None

        workspace_id = WORKSPACE_MAPPINGS.get(cwd)
        project_dir = project_dir_name_from_cwd(cwd)

        agent_record = {
            "id": sid,
            "provider": "opencode",
            "cwd": cwd,
            "createdAt": created_iso,
            "updatedAt": updated_iso,
            "lastActivityAt": updated_iso,
            "lastUserMessageAt": updated_iso,
            "title": title,
            "labels": {},
            "lastStatus": "closed",
            "lastModeId": "build",
            "config": {
                "modeId": "build",
                "model": model or "9router/codex"
            },
            "runtimeInfo": {
                "provider": "opencode",
                "sessionId": sid,
                "model": model or "9router/codex",
                "thinkingOptionId": None,
                "modeId": "build"
            },
            "features": [],
            "persistence": {
                "provider": "opencode",
                "sessionId": sid,
                "metadata": {
                    "cwd": cwd
                }
            },
            "requiresAttention": False,
            "attentionReason": None,
            "attentionTimestamp": None,
            "internal": False,
            "archivedAt": archived_iso
        }
        if workspace_id:
            agent_record["workspaceId"] = workspace_id

        # Write to all homes
        for home_dir in HOMES:
            target_dir = os.path.join(home_dir, "agents", project_dir)
            os.makedirs(target_dir, exist_ok=True)
            target_path = os.path.join(target_dir, f"{sid}.json")
            with open(target_path, "w", encoding="utf-8") as f:
                json.dump(agent_record, f, indent=2, ensure_ascii=False)

        synced_count += 1

    print(f"Successfully bridged {synced_count} OpenCode sessions across all Zencode agent homes!")

if __name__ == "__main__":
    sync_opencode_sessions()
