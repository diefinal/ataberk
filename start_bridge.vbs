Set WshShell = CreateObject("WScript.Shell")
' 0: Window is hidden
' false: Script does not wait for the process to exit
WshShell.Run "cmd.exe /c node local_bridge.js", 0, false
