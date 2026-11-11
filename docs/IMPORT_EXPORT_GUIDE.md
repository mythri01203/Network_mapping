# Import and export guide

This guide explains how to bring a map file into FiberGIS, how to undo an import, and how to save the network to a file. It was written for network mapping Phase 21 (November 2026).

Open it from the data menu, **Import or export a map file…**, or from Administration, Backup & KML. The window has three tabs: **Import**, **Past imports** and **Save to a file**.

## What files can be imported

| File | What to choose | Notes |
|---|---|---|
| KML or KMZ (Google Earth) | The `.kml` or `.kmz` file | Folders and styles become groups |
| GeoJSON | The `.geojson` or `.json` file | Must be WGS 84 latitude and longitude |
| CSV | The `.csv` file (also TSV or semicolon) | You choose the Latitude and Longitude columns, or a column with the shape as WKT text. Up to 2 MB |
| Shapefile | One `.zip` holding the `.shp`, `.dbf` and `.prj` files together | Zip loose files first. A single `.shp` is not enough |

Largest file: 30 MB.

## Importing, one step at a time

1. **Choose the file.** Nothing is saved yet.
2. **Match the columns** (GeoJSON, CSV and Shapefile only). Say which column has the name of each item, the notes, the kind of item, and the core count. For a CSV, also say which columns are Latitude and Longitude. A column called exactly "Latitude" or "name" is picked for you as a first choice; check it. Columns you do not choose are still kept with each item, exactly as written. The screen shows your choices before you go on.
3. **Say what each group is.** Each group is a folder (KML) or a value of the "kind of item" column. Choose what the items are (pole, box, cable, duct...), whether they are already in the street or only planned, and the core count for cables if you know it. Choose "Do not import" for anything you do not want.
4. **Check and import.** See what looks like something already on the map, choose which line ends to connect, and read what will be added. Then press **Import**.

The whole import is one step: the Undo button right after it removes all of it.

## Positions and coordinate systems

FiberGIS stores latitude and longitude in WGS 84 (what GPS and Google Earth use).

- **GeoJSON and CSV** must already be WGS 84. Numbers outside the latitude and longitude range (for example UTM metres such as 780000) are flagged at the top of step 3, and those items are not imported. A GeoJSON that says it uses another system is refused with its name.
- **Latitude and longitude the wrong way round** are flagged too. In India they cannot be confused, so a swap shows. Nothing is moved for you; fix the file or the column choice.
- **Shapefile:** the `.prj` file is read.
  - WGS 84: used as it is.
  - Another system that can be converted (for example WGS 84 UTM zone 43N): converted to latitude and longitude, and the screen says so.
  - A system that cannot be converted: that layer is refused with the system's name. Save it again as WGS 84 (EPSG:4326), for example in QGIS.
  - No `.prj` file: if the numbers look like latitude and longitude, you must tick "I know these positions are WGS 84" to go on, and that choice is kept with the import. If they do not, the layer is refused.
- Positions from a file are marked as imported, with accuracy not known. Altitude is dropped. Lengths are worked out from the lines; a length written in the file is never used.

## Items that look like ones already on the map

- A **point** of the same kind within the "same one?" distance (Administration, Poles and routes settings; 5 m to start with) is held back.
- A **line** that runs along a cable or duct already on the map (or earlier in the same file) for most of its length, with about the same length, is held back. It uses the two "same cable?" settings (10 m and 80% to start with).

Held-back items are listed with the item they look like. They are not imported unless you tick **Import them as new items anyway**; that choice is kept with the import.

## Line ends are never connected for you

A line drawn near a box does not prove the cable ends there. For each cable end near a box (and each duct end near a manhole or chamber), the check step lists up to three items within the map check's "cable end" distance (50 m to start with). Every end starts as **Leave it unconnected**. Only an end you choose is connected. Poles are never offered as cable ends: a cable on a pole is a pole attachment, made separately. No spans or attachments are made by an import.

## Past imports and undoing an import

Every import is kept under **Past imports**: the file, what kind of file, who imported it and when, how many items came in, how many were not imported or held back, how many ends a person connected, and everything that was chosen (column matching, group choices, coordinate system, warnings accepted).

**Undo this import** removes exactly the items that import added, all at once. It is sent to the office server in one go, with the same checks as any other change, so it needs a connection. It is refused, in plain words and with nothing changed, when:

- an item from the import was changed after the import (undo would lose that change);
- something else now uses an item from the import, such as a span on an imported pole, a customer on an imported box, or a cable ending at an imported box;
- someone else changed one of the items since this device loaded it;
- your account cannot delete network items (undo needs an engineer, a network admin or the administrator).

An undone import stays in the list, marked "Undone" with who, when and the reason given.

## Saving the network to a file

Under **Save to a file** (needs the export right):

| File | What it holds |
|---|---|
| Google Earth (.kml) | Equipment, cables, ducts, spans (drawn between their two poles), buildings (with their outline when drawn) and customers with a recorded position |
| Google Earth, zipped (.kmz) | The same KML in a zip, as Google Earth writes it |
| Excel (.xlsx) | A first sheet saying when, by whom and what, then one sheet per kind of record with every column of the table view |

In the Excel file a blank cell means not recorded; nothing is filled in. Text that a spreadsheet could run as a formula (starting with `=`, `+`, `-` or `@`) is kept as text, as in the CSV exports.

Customer details follow the same rules as everywhere else: a role that cannot see a customer's name, address, mobile or house position gets "Hidden for your role" in the file, and a hidden house position is left out of the map files.

## Not done yet

- No Shapefile export, and no import of Excel files. Save an Excel sheet as CSV to import it.
- No import API for other programs.
- Slack loops are not in the KML yet.
- CSV files above 2 MB must be split.
- Import has only been tried with test files made for it. Try a real operator's file and check the skipped list before relying on it.
