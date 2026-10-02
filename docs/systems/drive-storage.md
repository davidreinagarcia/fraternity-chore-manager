# Drive storage (carpeta raíz y estructura de fotos)

Todas las fotos que recoge la app van a **una sola carpeta de Drive que eligen los officers**, con la estructura montada por el código y organizada por semestre. Código en `DriveStorage.gs`; UI en `OfficerDashboard.html` → Admin → Drive Storage.

## Estado

Hecho. Probado con mocks (`DriveApp` simulado) y el dashboard en el harness local; nunca contra un Drive real.

## Estructura

```
<raíz>/
  <label_am_officer>/<semestre>/Signatures/<nombre del AM>/     fotos de firmas
  <label_chore + s>/<semestre>/Week_<yyyy-MM-dd>/               fotos de chores
  Forms/<semestre>/<título del form>/                           fotos de campos `photo` de los forms
```

Los nombres de carpeta de AM y chores salen de `CHAPTER_CONFIG.labels` (si el chapter no ha definido el label, vale el default central `LABEL_DEFAULTS` de `Code.gs`; el código de `DriveStorage.gs` no tiene ningún nombre de chapter escrito), así que cada chapter ve su vocabulario. Si cambia el label, aparece una carpeta nueva; las antiguas no se mueven. Los nombres se limpian (`/` y `\` pasan a `-`, máx. 80 caracteres).

Todo pasa por `driveFolder(area, semestre, partes)` (`area` = `am` | `chores` | `forms`), que crea lo que falte con `_getOrCreateFolder`. Los semestres nuevos se crean solos con la primera subida; no hay que hacer nada al cambiar de semestre. Quien suba una foto nueva de un AM nuevo también crea su carpeta.

Llamadores: `_saveSignaturePhotoToDrive` (Signatures.gs), `_savePhotoToDrive` (PhotoCheck.gs) y `_fmSavePhoto` (Forms.gs). Los archivos siguen siendo visibles por link.

## Elegir la carpeta

Clave de config `drive_root_folder_id` (oculta en el Config Editor; se cambia solo desde Drive Storage). API de officers, todas con PIN:

- `driveGetStorage`: estado, nombre y enlaces a cada área y al semestre actual. Detecta carpeta borrada o en la papelera (`broken`).
- `driveSetRoot(pin, link)`: acepta URL (`/folders/<id>`, `?id=<id>`) o id suelto. Comprueba que se abre, que no está en la papelera y que se puede escribir (crea y borra una carpeta `.write-test`). Guarda y construye el árbol.
- `driveCreateRoot`: crea `<chapter_name> Files` en el Drive de la cuenta de la app y construye el árbol.
- `driveBuildTree`: crea las carpetas del semestre actual, incluida una carpeta de firmas por cada AM con estado `associate`, para tener el álbum listo antes de la primera foto.

**Sin carpeta elegida**, la primera subida crea `<chapter_name> Files` en el My Drive de la cuenta que despliega la app y guarda su id. Así nada falla, pero lo normal es elegir una carpeta.

## Casos borde

- **Cuenta de ejecución**: la web app corre como `USER_DEPLOYING` (`appsscript.json`), así que la carpeta debe ser accesible con permiso de editor por esa cuenta, no por el officer que está mirando el dashboard. El mensaje de error lo dice.
- **Elegir otra carpeta no mueve nada**: lo ya subido se queda donde estaba. Los enlaces guardados en las hojas (`photo_url`, respuestas de forms) siguen funcionando.
- **Carpeta raíz borrada o sin permiso**: las subidas de firmas y chores devuelven URL vacía y las de forms fallan con error; el panel avisa con "can no longer be opened".
- Dos AMs con el mismo nombre completo comparten carpeta.
- Hay un hueco de carrera teórico: si dos primeras subidas simultáneas ocurren sin carpeta elegida, podrían crearse dos carpetas `... Files`. Elegir la carpeta antes lo evita.
- No hay selector nativo de Google Drive (Picker) porque pide una API key de Cloud por chapter; se pega el enlace.
- `chore_ratios.json` sigue buscándose por nombre en el Drive (no vive en esta estructura).

## Decisiones abiertas

- Botón para mover las fotos antiguas (`Signatures Pics/`, `ChorePhotos/`, `Form Uploads/`) a la estructura nueva.
- Pedir la carpeta en el setup wizard.
- Más áreas cuando aparezcan (guest list, finanzas).
