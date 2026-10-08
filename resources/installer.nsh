; PosBit NSIS custom installer script
; Este script se incluye en el proceso de instalación NSIS

!macro customHeader
  !system "echo Instalando PosBit..."
!macroend

!macro customInstall
  ; Crear directorio de datos de la app
  CreateDirectory "$LOCALAPPDATA\posbit"
  
  ; Registrar la aplicación en Windows (para desinstalación limpia)
  WriteRegStr HKCU "Software\PosBit" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\PosBit" "Version" "${VERSION}"
!macroend

!macro customUnInstall
  ; Preguntar si desea borrar los datos
  MessageBox MB_YESNO "¿Desea eliminar los datos de la aplicación (base de datos, configuración)?" IDYES deleteData IDNO skipDelete
  
  deleteData:
    RMDir /r "$LOCALAPPDATA\posbit"
    DeleteRegKey HKCU "Software\PosBit"
    Goto done
  
  skipDelete:
    DeleteRegKey HKCU "Software\PosBit"
    
  done:
!macroend
