# plume — spline-driven L-system feather study

A compact generative-feather playground. The feathers grow along one editable spline and use an editable L-system for their filaments.

## Use as a mesh material in OXIDE

In the parent project's viewer, choose **Feathers** in the material picker.
In **Settings → Feather style**, switch between **Layered feathers** (filled,
overlapping contour vanes) and **Original plumes** (the study's open barbs and
L-system filaments, with no filled vane). Both retain the same roots, density,
size, layering direction, wind and skin settings, with shadows matching each
style's geometry. The original plumes use the viewer's normal blending rather
than the standalone study's additive glow. The selected style is included by
**Copy settings** and stays selected when changing meshes. **Reset defaults**
restores the Original plumes preset: 4% mesh density, 2× length, 1.9× width,
100% filament density, 46° branches, 100% opacity and 84% shadows. This is
also the starting preset when choosing Feathers.
**Preset 1** recalls these saved feather values without changing the selected
shape or model. Click a feather in the viewer, or **Fly all** in Settings, to
launch the entire coat together. Feathers ease off the surface, then drift,
turn and flutter throughout the camera's visible 3D space, including its
foreground and edges. The volume follows camera framing and viewport size;
feathers are not tethered to a small radius around their original roots.
Flying feathers
use predictive separation steering and box collision proxies, with no count
cap. The proxies approximate the whole vane rather than simulating every
filament. Attached feathers keep their natural overlapping arrangement.
**Return feathers** gently gathers the feathers, aligns them, and eases them
back onto their current mesh roots. Motion stops once the coat has settled.
**Fly all** can interrupt a return and smoothly release the feathers again.
Dragging still orbits the camera; changing geometry, density, model or preset
also restores the coat. Wind direction and breeze influence the flying feathers.
In **Settings → L-system**, control branch generations (0–8), branch length
(0–10×), and branch randomness (0–100%). Edit the **Axiom**, **Rule for X** and
**Rule for F**, then click **Apply grammar** or press Enter in a rule field.
`F` draws forward, `+`/`-` turn, `[`/`]` branch, and `X` is rewritten by its
rule. Use balanced brackets. Empty production rules erase their symbol.
**Reset grammar** restores just the L-system controls, keeping density, size,
skin, and wind values selected.
These rules shape the fine branching filaments; length and width still shape
the whole feather. Grammar changes keep the mesh roots in place and work with
both styles. **Copy settings** includes the grammar, and **Preset 1** restores
the original rules with two generations, 1× branch length and 100% randomness.

Size and density controls retain their expanded ranges: length and width
reach 20×, mesh and filament density reach 1000%, branch angle reaches 600°,
lift reaches 900°, direction controls reach 3600°, and breeze reaches 1000%.
Opacity, shadows, subsurface scattering and branch randomness are bounded to
0–100% in both the menu and rendering settings. Preset 1 and starting values
are unchanged.
The **Feather density** slider runs from **0%** (none) to **1000%**, starting at
4%. At 100%, density places 100 feathers per square scene unit; 1000% places
1000 per unit, with no limit on the total number of feathers. Counts scale directly
with surface area and density. Roots are sampled by triangle area, then
spread apart using progressive best-candidate sampling. Increasing density
keeps existing roots in place. Each root is anchored to the skin surface.
The underlying mesh has a softly mottled, porous skin material and small,
raised follicle rims at the actual feather roots. The skin and follicles stay
visible when feather opacity is lowered.
**Skin & layering → Subsurface scattering** controls a real-time approximation
of light spreading through skin, starting at 35%. It combines wrapped diffuse
lighting with warm, attenuated back-scattering and a procedural thickness
variation. Set it to 0% for the original physical skin lighting. It preserves
skin opacity, pores, highlights, and feather contact shadows, including on
animated models. This is a local lighting approximation, without a measured
thickness map or volumetric diffusion pass.
Reference: [Three.js subsurface-scattering example](https://threejs.org/examples/webgl_materials_subsurface_scattering.html).

The Layered feathers style uses contour vanes over bare quills, with a shared tangent
flow and a 22° lift above the skin. This gives neighboring feathers overlapping
tips and covered bases. In **Settings → Skin & layering**, change skin colour,
feather lift (10–900°), and plumage direction. At 90°, shafts stand upright.
Contour outlines use smooth width variation and a sparse, short fringe with
matching keratin pigment. Blended crown flow and a stable front/back part keep
the coat coherent over caps and body faces without an abrupt pole fallback.
This is a bird-inspired arrangement for arbitrary meshes, preserving even
coverage; it does not attempt species-specific feather tracts or the preen gland.
Reference: [Cornell Lab's contour feather anatomy](https://academy.allaboutbirds.org/feathers-article/).

The compact **Settings** menu also adjusts length, width, filament density,
branch angle and opacity. Mesh feathers use bounded, tone-mapped colors,
keeping dense overlaps from accumulating light. At 100% opacity, filaments
render as opaque geometry and write depth, so the nearest filament wins.
At partial opacity, weighted blended order-independent transparency combines
overlapping filaments without sorting individual feathers. This is an
approximation to sorted alpha blending, using separate color accumulation
and revealage passes, with opaque-scene depth tests and a final composite.
On devices without floating-point render targets, alpha-hashed transparency
provides depth-correct coverage with some grain. Opacity controls filament
transparency from 0% to 100%. Settings remain selected when changing
meshes. **Reset defaults** restores the starting appearance and mesh density.
**Shadows** adds soft occlusion between overlapping vanes and onto the skin,
starting at 84%. Set it to 0% to disable feather shadows. A dedicated depth pass
uses the same feather deformation as the visible geometry, including breeze
and body animation. Partial opacity uses hashed shadow coverage. The map is
cached during camera orbit and regenerated when the feathers or light change.
**Breeze** adds wind-driven bending and flutter from 0% (calm) to 1000%.
**Wind direction** selects where the breeze blows around the ground plane:
0° East, 90° North, 180° West, 270° South. The small compass follows the selected
direction. Wind stays fixed in the scene while you orbit the camera, and feather
roots stay attached to the mesh. Breeze starts at 0%; raising it starts motion,
and returning to 0% restores still feathers and stops continuous rendering.
Click outside the menu or press Escape to close it; click Settings or the
selected Feathers material to reopen it.

This works on all built-in shapes, the Horse sample and imported GLB meshes.
Roots follow animated or morphed meshes. Choose a metal or Paint to return to
corrosion and peeling.

The viewer shares `feather-generator.js` with this study and uses the parent's
local Three.js renderer. The spline editor, bloom and hold-to-fly interaction
remain in this standalone study.

## Run

Open a terminal in the parent project folder:

```sh
python3 -m http.server 8000
```

Open **http://localhost:8000/plume/**, or click **Plume ↗** at the top of the
OXIDE viewer. **← OXIDE** returns to the viewer. The old `/plume-lsystem/`
address redirects to `/plume/`.

The full Three.js renderer loads modules from `esm.sh` and requires internet access; if those modules are blocked, the page switches to the dependency-free Canvas 2D renderer.

## Fly away / return

- **Press and hold** empty space (mouse or touch) and the feathers start flying in wandering, wind-driven trajectories.
- They keep moving while held, rather than aiming at static random destinations. A shared slow gust, per-feather curl noise and a mild repulsion from the pointer create a loose flock effect.
- **Release** and a damped spring carries each feather back to its original position and orientation on the spline.
- The **Breeze** slider influences the strength of the wandering wind.
- Dragging a spline handle edits the curve instead of triggering flight.

## Add / edit spline points

- Click **+ Add spline point** to insert a new control point in the longest interval of the existing spline.
- **Double-click the visible spline** to insert a point at that position.
- **Shift-click near the spline** also inserts a point (desktop).
- Drag an existing handle to reshape the spline; feather positions update without rebaking all the fibers.
- **Reset spline** restores the five initial points.
- **Spline spacing** sets the arc-length interval in world units between feather placements.
- Up to 36 spline points and 65 feathers are supported to keep the artwork responsive.

## Camera and controls

- **Three.js renderer:** drag empty space to orbit the camera, scroll/pinch to zoom.
- **Canvas fallback:** scroll to zoom; it does not provide true 3D orbit.
- On narrow screens, the controls start collapsed so more of the artwork is visible; tap **Show controls** to expand them.

## Grammar

Edit the axiom and two production rules directly on the page. The terminal filaments are interpreted with:

- `F`: draw forward
- `+` and `-`: rotate by the selected branch angle
- `[` and `]`: save and restore the turtle state

Default:

```text
Axiom: X
X -> F[+X][-X]
F -> FF
```

## Files

- `../plume/index.html` — interface and styling, with no inline scripts
- `index.html` — redirect from the original study address
- `boot.js` — renderer selection and panel toggle
- `three-scene.js` — full Three.js scene, orbit controls and spline editing
- `feather-generator.js` — shared, deterministic shaft, barb and L-system filament geometry
- `fallback.js` — dependency-free Canvas renderer and spline editing
- `flight.js` — shared wind/flock simulation and spring reassembly
