#!/usr/bin/env python3
"""
Generate historical git commits between 2026-01-31 and 2026-02-15.
- Randomly skip 2 days
- For each other day create 1-5 commits with randomized messages/times
- Creates local repo/init if needed and makes commits with GIT_AUTHOR_DATE/GIT_COMMITTER_DATE

Run: python3 scripts/gen_commits.py

DOES NOT push to GitHub. Use the provided push script or `git push` yourself (do NOT paste tokens here).
"""
import subprocess
import datetime
import random
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
os.chdir(ROOT)

def run(cmd, env=None, check=True):
    print('>', ' '.join(cmd))
    return subprocess.run(cmd, env=env, check=check)

# repo init if necessary
if not os.path.isdir(os.path.join(ROOT, '.git')):
    print('No git repo found — initializing repository and making an initial commit')
    run(['git', 'init'])
    # stage everything
    run(['git', 'add', '--all'])
    env = os.environ.copy()
    env.update({
        'GIT_AUTHOR_DATE': '2026-01-30T12:00:00',
        'GIT_COMMITTER_DATE': '2026-01-30T12:00:00',
    })
    try:
        run(['git', 'commit', '-m', 'chore: initial commit (base for history)'], env=env)
    except subprocess.CalledProcessError:
        print('Initial commit failed (maybe already committed). Continuing...')

# author identity — allow override with env vars
author_name = os.environ.get('GIT_AUTHOR_NAME') or subprocess.run(['git','config','user.name'], capture_output=True, text=True).stdout.strip() or 'MindMap User'
author_email = os.environ.get('GIT_AUTHOR_EMAIL') or subprocess.run(['git','config','user.email'], capture_output=True, text=True).stdout.strip() or 'you@example.com'

start = datetime.date(2026, 1, 31)
end = datetime.date(2026, 2, 15)

# build all dates
days = []
d = start
while d <= end:
    days.append(d)
    d += datetime.timedelta(days=1)

# randomly pick 2 days to skip
skips = set(random.sample(days, 2))
print('Skipping these 2 days (no commits):', ', '.join(s.isoformat() for s in sorted(skips)))

messages = [
    'chore: small refactor',
    'fix: tidy up layout',
    'feat: improve toolbar behavior',
    'docs: update README',
    'test: add smoke check',
    'chore: update styles',
    'perf: minor optimization',
    'refactor: reorganize files'
]

total_commits = 0
for day in days:
    if day in skips:
        continue
    count = random.randint(1,5)
    for i in range(count):
        # random time in the day
        hour = random.randint(9,20)
        minute = random.randint(0,59)
        second = random.randint(0,59)
        datestr = f"{day.isoformat()}T{hour:02d}:{minute:02d}:{second:02d}"
        msg = random.choice(messages) + f" ({day.isoformat()} #{i+1})"
        env = os.environ.copy()
        env.update({
            'GIT_AUTHOR_DATE': datestr,
            'GIT_COMMITTER_DATE': datestr,
            'GIT_AUTHOR_NAME': author_name,
            'GIT_AUTHOR_EMAIL': author_email,
            'GIT_COMMITTER_NAME': author_name,
            'GIT_COMMITTER_EMAIL': author_email,
        })
        # create an empty commit with a timestamp
        run(['git', 'commit', '--allow-empty', '-m', msg], env=env)
        total_commits += 1

print(f'Done — created {total_commits} new commits (skipped 2 days).')
print('Run `git log --oneline --decorate --all --date=iso` to inspect. To push, run the push helper or push manually.')
