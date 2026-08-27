# Templates

Runs dropped in this directory turn up on the **Templates** shelf in the app's
library, ready to be put on the stage.

Nothing here is built in — a template is one of your own runs.

## Adding one

1. Build the run in the app and hit **Save**. That writes a `.mrun.json` file.
2. Drop that file into this directory.

It appears on the shelf under the project's own name. The dev server picks up a
new file straight away; a production build carries whatever is in here when it
is built.

## A picture on the card (optional)

Leave an image beside the run under the same name and the card shows it instead
of the outline drawing:

```
templates/spiral-tower.mrun.json
templates/spiral-tower.png
```

`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg` and `.avif` all work. A
screenshot of the stage is the obvious thing to use. It is cropped to fill the
tile, so anything roughly landscape sits best.

## A line about the run (optional)

Open the `.mrun.json` in a text editor and add a `description` next to the name:

```json
{
  "format": "marble-run-generator",
  "version": 9,
  "name": "Spiral Tower",
  "description": "Four levels down a tapering coil, out along the floor.",
  ...
}
```

The app ignores the field when the run is loaded — it is only there for the
card. Everything else on the card is measured off the run itself: how many
parts, how long the track is, how far it falls.

## Notes

- The run arrives exactly as it was saved, in the tube it was cut from and
  standing where it was left. Nothing is re-centred or tidied up.
- Loading a template replaces what is on the stage, so the app asks first.
- A file in here that cannot be read still gets a card, saying what is wrong
  with it rather than quietly vanishing.
