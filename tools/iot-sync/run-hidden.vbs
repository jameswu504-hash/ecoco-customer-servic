Option Explicit

Dim fileSystem, shell, scriptDirectory, command
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ _
  & fileSystem.BuildPath(scriptDirectory, "run-once.ps1") & """"

shell.Run command, 0, False
