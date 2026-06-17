MacClipper Main-Logs

This folder is packaged into the app so the logging entry point is always visible
inside Show Package Contents.

Live logs are written to:
~/Library/Logs/MacClipper/Main-Logs/main.log

MacClipper keeps the active log outside the signed app bundle so logging does not
mutate the packaged app after signing.