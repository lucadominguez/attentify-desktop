; Custom NSIS hooks for the Attentify installer.
;
; customInit refuses to install on anything below Windows 10. Attentify runs on Electron
; 28 (Chromium 120), which will not start on Windows 8.1 or earlier — so without this gate
; the install "succeeds" and the app then fails to launch with no explanation. Blocking it
; here is the only place we can still show the user a real reason.
!include WinVer.nsh

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Attentify requires Windows 10 (version 1809) or newer.$\r$\n$\r$\nThis PC is running an older version of Windows, where the app cannot start."
    Abort
  ${EndIf}
!macroend
;
; customUnInstall runs while the app files are still present on disk, BEFORE the
; uninstaller deletes them. We launch the app once with `--uninstall-cleanup` so it
; reverses every machine-level change it made (hosts entries, firewall rules, browser
; DNS policies, the login/startup task) instead of leaving them behind. The app runs
; headless, exits fast, and self-kills after 20s, so a hung child can't wedge the
; uninstaller. ExecWait blocks until it returns; failures are ignored on purpose —
; a cleanup that can't run must never block removal.
!macro customUnInstall
  DetailPrint "Reverting Attentify system changes..."
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-cleanup' $0
!macroend
