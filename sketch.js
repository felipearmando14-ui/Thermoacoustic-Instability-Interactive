
// Thermoacoustic Instability, Demo 1: The Resonator
//
// The apparatus is a Rijke tube: a vertical pipe, open at both ends, with air
// entering at the bottom and leaving at the top. Its fundamental acoustic mode
// behaves, to first order, like a single damped harmonic oscillator: pulse it
// and it rings at its own natural pitch, then the ringing dies out. There is no
// mean flow, no heat release and no flame in this demo. Heat arrives in Demo 2,
// which will reuse `chamber.step()` and simply add a heat-release drive term to
// pressureAcceleration.
//
// The gas is drawn as "Variant D" from the visualization study: a density
// shading of local pressure, with a sparse layer of advected tracer particles
// on top so the gas motion behind the shading stays visible.
//
// p5.js instance mode is used throughout so this sketch can later sit
// side-by-side with other demos on the same page.
// ============================================================================

const sketch = (p) => {

  // -------------------------------------------------------------------------
  // Tunable constants
  // -------------------------------------------------------------------------

  // SPEED_CONSTANT sets naturalFrequency = SPEED_CONSTANT / chamberLength.
  // Chosen (against the slider's 60-220 range) so the visible ringing sits
  // roughly between 0.8 Hz and 3 Hz, a demo pace rather than a physical one.
  const SPEED_CONSTANT = 180;

  // Small positive damping so a pulse rings for roughly 6-8 seconds before
  // settling back to rest.
  const DAMPING_COEFFICIENT = 0.6;

  // Fixed physics timestep. The integrator always advances by exactly this
  // much, however long the display takes to produce a frame; draw() runs as
  // many of these steps as the elapsed wall-clock time has earned. Small
  // enough to stay stable at the top of the natural-frequency range.
  const TIME_STEP = 1 / 240;

  // The trace is sampled on its own clock, also independent of frame rate, so
  // the plotted window is a true TRACE_SECONDS on a 60 Hz and a 120 Hz display
  // alike.
  const TRACE_SAMPLE_INTERVAL = 1 / 60; // seconds between trace samples

  // A frame gap longer than this means the tab was backgrounded or the
  // debugger was paused. Simulating it would fast-forward the ring-down in one
  // jump, so we simply drop the missing time.
  const MAX_FRAME_SECONDS = 0.1;

  // Pressure amplitude of a pulse, and the reference the shading saturates
  // against.
  const MAX_PRESSURE = 46;

  // Variant D rendering. Real acoustic displacements are microscopic, so the
  // tracer motion is pure exaggeration: this is how many pixels one unit of
  // pressure amplitude is worth at the peak of the swing.
  const DISPLACEMENT_PIXELS_PER_PRESSURE = 2.5;
  const TRACER_COUNT = 24;
  const TRACER_DIAMETER = 6;
  const SHADING_STRIP_COUNT = 200;

  // Where the pressure sensor is mounted, as a normalized position along the
  // tube: 0 is the bottom (inlet), 1 the top (outlet). Mid-height is exactly
  // where a real rig puts its pressure transducer: in an open-open tube the
  // centre is the pressure antinode, so it sees the largest signal the mode
  // has to offer, while a probe at either open end would sit on a node and
  // read almost nothing.
  const SENSOR_NORMALIZED_POSITION = 0.5;
  const SENSOR_DIAMETER = 12;
  const SENSOR_HORIZONTAL_OFFSET = 16; // label sits this far outside the wall

  // The heated gauze of a real Rijke tube, drawn a quarter of the way up.
  // Inert here; see drawHeaterGauze() for why it is on screen at all.
  const HEATER_NORMALIZED_POSITION = 0.25;
  const HEATER_BAND_HEIGHT = 12;

  // Scrolling trace: fixed time window and fixed vertical scale.
  const TRACE_SECONDS = 7;
  const TRACE_MAX_PRESSURE = MAX_PRESSURE;

  // Tube length is driven by the HTML slider; these mirror its min/max.
  const CHAMBER_LENGTH_MIN = 60;
  const CHAMBER_LENGTH_MAX = 220;

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  const CANVAS_WIDTH = 860;
  const CANVAS_HEIGHT = 620;

  // Tube occupies a left column; the trace panel sits to its right.
  //
  // The tube is anchored at its bottom: the length slider grows it upward, so
  // TUBE_BOTTOM_Y is fixed and only the top end moves. The inlet therefore
  // stays put on screen while the length changes, which is what makes the
  // pitch change legible as "the tube got shorter" rather than "everything
  // moved".
  const TUBE_CENTER_X = 230;
  const TUBE_BOTTOM_Y = 560;
  const TUBE_WIDTH = 110;
  const TUBE_MIN_PIXEL_LENGTH = 260;
  const TUBE_MAX_PIXEL_LENGTH = 470;

  const LEGEND_Y = 597;

  const TRACE_LEFT = 430;
  const TRACE_RIGHT = 820;
  const TRACE_TOP = 200;
  const TRACE_HEIGHT = 180;

  const COLOR_BACKGROUND = () => p.color('#f7f5f0');
  const COLOR_PANEL = () => p.color('#ffffff');
  const COLOR_INK = () => p.color('#23241f');
  const COLOR_INK_SOFT = () => p.color('#5b5d54');
  const COLOR_WALL = () => p.color('#3a3b34');
  const COLOR_ACCENT_WARM = () => p.color('#d9762b');

  // The gauze is drawn in a dim grey, not the warm accent, because it is off.
  const COLOR_HEATER_OFF = () => p.color('#9a9a92');

  // The sensor and the trace it feeds share one colour, so the green dot on
  // the wall and the green curve beside it read as the same instrument.
  const COLOR_SENSOR = () => p.color('#1f9254');
  const COLOR_TRACE = () => COLOR_SENSOR();

  // Variant D palette. Neutral is the gas at rest, so an un-pulsed tube
  // reads as "nothing happening" rather than as a colour.
  const COLOR_GAS_NEUTRAL = () => p.color('#f2efe9');
  const COLOR_COMPRESSION = () => p.color('#b3401f'); // warm: pressure above rest
  const COLOR_RAREFACTION = () => p.color('#4a90c4'); // cool: pressure below rest
  const COLOR_TRACER = () => p.color('#23241f');

  const FONT_LABEL = 'Source Sans 3';
  const FONT_MONO = 'IBM Plex Mono';

  // -------------------------------------------------------------------------
  // Chamber physics state
  //
  // Self-contained on purpose: Demo 2 can take this whole object, keep
  // step() as-is (or add a drive term to pressureAcceleration), and reuse
  // every rendering function below unchanged.
  // -------------------------------------------------------------------------
  const chamber = {
    pressure: 0,               // acoustic pressure, how "swollen" the standing wave is right now
    pressureVelocity: 0,       // rate of change of pressure
    pressureAcceleration: 0,   // rate of change of pressureVelocity
    angularFrequency: 0,       // 2 * PI * naturalFrequency, updated each frame from chamberLength
    dampingCoefficient: DAMPING_COEFFICIENT,

    step(timeStep) {
      // Restoring force: the acoustic mode behaves like a spring, pulling
      // pressure back toward zero (rest) with a strength set by the
      // tube's natural frequency.
      const restoringForce = -(this.angularFrequency * this.angularFrequency) * this.pressure;

      // Damping force: drains energy from the oscillation, proportional to
      // how fast pressure is currently changing. This is the only reason a
      // pulse ever dies out.
      const dampingForce = -2 * this.dampingCoefficient * this.pressureVelocity;

      this.pressureAcceleration = restoringForce + dampingForce;

      // Semi-implicit (symplectic) Euler: update velocity first, then use
      // the updated velocity to update position. More stable for an
      // oscillator than plain forward Euler.
      this.pressureVelocity += this.pressureAcceleration * timeStep;
      this.pressure += this.pressureVelocity * timeStep;
    }
  };

  // -------------------------------------------------------------------------
  // Demo state outside the physics object
  // -------------------------------------------------------------------------

  let chamberLength = 140;     // arbitrary units; drives both pitch and drawn tube length
  let naturalFrequency = 0;    // Hz, recomputed each frame from chamberLength

  let pressureHistory = [];    // fixed-length ring buffer for the scrolling trace
  let tracerRestPositions = [];// normalized rest positions (0..1) of the Variant D tracers

  // Leftover wall-clock time not yet consumed by a whole physics step or a
  // whole trace sample. Carrying it across frames is what decouples both
  // clocks from the display's refresh rate.
  let physicsTimeAccumulator = 0;
  let traceSampleAccumulator = 0;

  let chamberLengthSlider, pulseButton;

  // -------------------------------------------------------------------------
  // p5 lifecycle
  // -------------------------------------------------------------------------

  p.setup = () => {
    const canvas = p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    canvas.parent('canvas-holder');

    const traceSampleCount = Math.round(TRACE_SECONDS / TRACE_SAMPLE_INTERVAL);
    pressureHistory = new Array(traceSampleCount).fill(0);

    for (let i = 0; i < TRACER_COUNT; i++) {
      tracerRestPositions.push((i + 0.5) / TRACER_COUNT);
    }

    chamberLengthSlider = p.select('#chamberLengthSlider');
    chamberLengthSlider.input(() => {
      chamberLength = Number(chamberLengthSlider.value());
    });
    chamberLength = Number(chamberLengthSlider.value());

    pulseButton = p.select('#pulseButton');
    pulseButton.mousePressed(triggerPulse);
  };

  p.draw = () => {
    updateChamberFrequencyFromLength();

    // Advance both clocks by real elapsed time rather than by "one frame".
    // On a 120 Hz display this runs half as many steps per frame and twice as
    // many frames per second, so the ring-down takes the same number of
    // seconds and the reported pitch is the pitch you actually see.
    const elapsedSeconds = Math.min(p.deltaTime / 1000, MAX_FRAME_SECONDS);

    physicsTimeAccumulator += elapsedSeconds;
    while (physicsTimeAccumulator >= TIME_STEP) {
      chamber.step(TIME_STEP);
      physicsTimeAccumulator -= TIME_STEP;
    }

    // The trace plots what the sensor sees, not the raw modal amplitude:
    // it samples the pressure field at the sensor's own position.
    traceSampleAccumulator += elapsedSeconds;
    while (traceSampleAccumulator >= TRACE_SAMPLE_INTERVAL) {
      pressureHistory.push(localPressureAt(SENSOR_NORMALIZED_POSITION));
      pressureHistory.shift();
      traceSampleAccumulator -= TRACE_SAMPLE_INTERVAL;
    }

    p.background(COLOR_BACKGROUND());
    const tubeGeometry = getTubeGeometry();
    drawDensityShading(tubeGeometry);
    drawHeaterGauze(tubeGeometry);
    drawTracerParticles(tubeGeometry);
    drawTube(tubeGeometry);
    drawFlowArrows(tubeGeometry);
    drawSensor(tubeGeometry);
    drawColorLegend();
    drawFrequencyReadout();
    drawTracePanel();
  };

  // -------------------------------------------------------------------------
  // Physics-adjacent helpers (not rendering, not integration)
  // -------------------------------------------------------------------------

  function updateChamberFrequencyFromLength() {
    naturalFrequency = SPEED_CONSTANT / chamberLength;
    chamber.angularFrequency = 2 * p.PI * naturalFrequency;
  }

  function triggerPulse() {
    chamber.pressure = MAX_PRESSURE * 0.7;
    chamber.pressureVelocity = 0;
  }

  // -------------------------------------------------------------------------
  // Mode shapes for the fundamental of an OPEN-OPEN tube
  //
  // normalizedPosition (u) runs 0..1 from the bottom inlet to the top outlet.
  // Pressure is the spatial derivative of displacement, which is why the two
  // peak in different places:
  //   - at an open end the gas is free to move but cannot sustain a pressure
  //     difference against the outside atmosphere, so pressure is pinned to
  //     zero there and displacement is maximum: the column sloshes in and out
  //     of the opening.
  //   - at the centre the gas is most constrained, squeezed between the
  //     columns on either side, so pressure peaks there and displacement
  //     passes through zero.
  // This is the mirror image of a closed-closed duct, where the rigid walls
  // pin displacement instead of pressure.
  // -------------------------------------------------------------------------

  function pressureShape(normalizedPosition) {
    return Math.sin(Math.PI * normalizedPosition);
  }

  function displacementShape(normalizedPosition) {
    return Math.cos(Math.PI * normalizedPosition);
  }

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  // Screen y grows downward while u grows upward, so every vertical position
  // in the tube goes through this one inversion. Nothing else should do the
  // arithmetic by hand.
  function yForNormalizedPosition(u, tubeGeometry) {
    return tubeGeometry.tubeBottomY - u * tubeGeometry.tubePixelLength;
  }

  function getTubeGeometry() {
    const tubePixelLength = p.map(
      chamberLength,
      CHAMBER_LENGTH_MIN, CHAMBER_LENGTH_MAX,
      TUBE_MIN_PIXEL_LENGTH, TUBE_MAX_PIXEL_LENGTH
    );
    return {
      tubePixelLength,
      tubeBottomY: TUBE_BOTTOM_Y,
      tubeTopY: TUBE_BOTTOM_Y - tubePixelLength,
      tubeCenterX: TUBE_CENTER_X,
      tubeLeftX: TUBE_CENTER_X - TUBE_WIDTH / 2,
      tubeRightX: TUBE_CENTER_X + TUBE_WIDTH / 2
    };
  }

  // -------------------------------------------------------------------------
  // Rendering the gas (Variant D: shading + tracer particles)
  // -------------------------------------------------------------------------

  // Local pressure at a point in the tube is the mode shape scaled by the
  // oscillator's current amplitude, so the whole field breathes in and out
  // together rather than travelling along the tube.
  function localPressureAt(normalizedPosition) {
    return chamber.pressure * pressureShape(normalizedPosition);
  }

  function pressureToShadingColor(localPressure) {
    const intensity = p.constrain(Math.abs(localPressure) / MAX_PRESSURE, 0, 1);
    const target = localPressure >= 0 ? COLOR_COMPRESSION() : COLOR_RAREFACTION();
    return p.lerpColor(COLOR_GAS_NEUTRAL(), target, intensity);
  }

  // The field varies along the tube's axis, which is now vertical, so the
  // shading is a stack of full-width horizontal bands rather than a row of
  // vertical strips.
  function drawDensityShading(tubeGeometry) {
    const { tubeLeftX, tubePixelLength } = tubeGeometry;
    const bandHeight = tubePixelLength / SHADING_STRIP_COUNT + 1; // +1 avoids hairline seams

    p.rectMode(p.CORNER);
    p.noStroke();
    for (let i = 0; i < SHADING_STRIP_COUNT; i++) {
      const normalizedPosition = (i + 0.5) / SHADING_STRIP_COUNT;
      p.fill(pressureToShadingColor(localPressureAt(normalizedPosition)));
      // Band i spans u from i/N to (i+1)/N; the upper edge of that span is the
      // smaller screen y, so that is the rectangle's top.
      const bandTopY = yForNormalizedPosition((i + 1) / SHADING_STRIP_COUNT, tubeGeometry);
      p.rect(tubeLeftX, bandTopY, TUBE_WIDTH, bandHeight);
    }
  }

  // The heated gauze of a real Rijke tube, drawn a quarter of the way up.
  //
  // It is completely inert in this demo: no heat release, no coupling, nothing
  // reads HEATER_NORMALIZED_POSITION except this function. It is on screen so
  // that the apparatus stays visually identical across all four demos, and so
  // that the object whose position becomes the central knob in Demo 4 is
  // already familiar by the time it starts to matter. This is deliberate, not
  // dead code left behind.
  function drawHeaterGauze(tubeGeometry) {
    const { tubeLeftX, tubeRightX } = tubeGeometry;
    const centerY = yForNormalizedPosition(HEATER_NORMALIZED_POSITION, tubeGeometry);
    const topY = centerY - HEATER_BAND_HEIGHT / 2;
    const bottomY = centerY + HEATER_BAND_HEIGHT / 2;

    // Cross-hatch: a gauze is a mesh, and the mesh reads as "an object in the
    // flow" without the solid fill that would hide the shading behind it.
    p.stroke(COLOR_HEATER_OFF());
    p.strokeWeight(1);
    p.line(tubeLeftX, topY, tubeRightX, topY);
    p.line(tubeLeftX, bottomY, tubeRightX, bottomY);
    for (let x = tubeLeftX; x <= tubeRightX - HEATER_BAND_HEIGHT; x += 8) {
      p.line(x, bottomY, x + HEATER_BAND_HEIGHT, topY);
      p.line(x, topY, x + HEATER_BAND_HEIGHT, bottomY);
    }

    p.noStroke();
    p.fill(COLOR_HEATER_OFF());
    p.textFont(FONT_LABEL);
    p.textSize(11);
    p.textAlign(p.RIGHT, p.CENTER);
    p.text('heater — off', tubeLeftX - 10, centerY);
  }

  // Tracer displacement amplitude, in pixels.
  //
  // Particle displacement is IN PHASE with pressure in a standing wave
  // (velocity leads by a quarter cycle). Parcels sit at maximum excursion
  // exactly when pressure peaks, which is what makes the crowding line up
  // with the shading.
  //
  // With displacement A*cos(PI*u), pressure goes like +A*sin(PI*u), while the
  // shading paints pressure*sin(PI*u). Matching the two gives
  // A = +gain * pressure. Read physically: when pressure is positive, parcels
  // below the centre move up and parcels above it move down, converging on the
  // middle, and converging gas is exactly the compression the shading paints
  // warm there.
  //
  // The swing is capped so parcels do not pile through one another. Adjacent
  // parcels sit (length - A*PI*sin(PI*u)) / N apart, so the tightest gap
  // anywhere is (length - |A|*PI) / N; holding that at one parcel width plus a
  // hair gives the limit below. The tight spot is now the centre rather than
  // the ends, but the expression is unchanged. Scaling every parcel by the
  // same factor preserves the cos(PI*u) shape.
  function tracerAmplitudePixels(tubePixelLength) {
    const requestedAmplitude = +DISPLACEMENT_PIXELS_PER_PRESSURE * chamber.pressure;
    const minimumGapPixels = TRACER_DIAMETER + 2;
    const maxAmplitude = Math.max(0, (tubePixelLength - TRACER_COUNT * minimumGapPixels) / Math.PI);
    return p.constrain(requestedAmplitude, -maxAmplitude, maxAmplitude);
  }

  // The tracers are advected, not painted: each one only ever moves up and
  // down from its own rest position, in a single column on the tube's axis.
  // The crowding and thinning you see is a consequence of that motion, not
  // something drawn on top of it.
  //
  // Note that nothing clamps the parcels inside the tube. The mode shape
  // cos(PI*u) gives the largest excursion at the two open ends, and air really
  // does slosh in and out of an open end: at large amplitude the end parcels
  // should visibly cross the boundary. Pinning them at the opening would draw
  // a wall that is not there.
  function drawTracerParticles(tubeGeometry) {
    const { tubeCenterX, tubePixelLength } = tubeGeometry;
    const amplitudePixels = tracerAmplitudePixels(tubePixelLength);

    p.noStroke();
    p.fill(COLOR_TRACER());
    for (const restPosition of tracerRestPositions) {
      const offsetPixels = amplitudePixels * displacementShape(restPosition);
      // Minus: a positive displacement means "toward the top of the tube",
      // which is a decrease in screen y.
      const drawnY = yForNormalizedPosition(restPosition, tubeGeometry) - offsetPixels;
      p.circle(tubeCenterX, drawnY, TRACER_DIAMETER);
    }
  }

  // Two side walls and nothing across the ends. The missing top and bottom
  // edges are the whole point: this is a pipe open to the room at both ends,
  // not a sealed box.
  function drawTube(tubeGeometry) {
    const { tubeLeftX, tubeRightX, tubeTopY, tubeBottomY } = tubeGeometry;

    p.stroke(COLOR_WALL());
    p.strokeWeight(2.5);
    p.line(tubeLeftX, tubeTopY, tubeLeftX, tubeBottomY);
    p.line(tubeRightX, tubeTopY, tubeRightX, tubeBottomY);
    p.strokeWeight(1);
  }

  // Small arrows outside each opening, both pointing up: air in at the bottom,
  // out at the top. They say "flow-through device" rather than "sealed
  // chamber", which is the entire reason this demo is a Rijke tube and not the
  // closed duct it started as. (The flow itself is not modelled here.)
  function drawFlowArrows(tubeGeometry) {
    const { tubeCenterX, tubeTopY, tubeBottomY } = tubeGeometry;

    drawUpwardArrow(tubeCenterX, tubeBottomY + 26, tubeBottomY + 8);
    drawUpwardArrow(tubeCenterX, tubeTopY - 8, tubeTopY - 26);

    p.noStroke();
    p.fill(COLOR_INK_SOFT());
    p.textFont(FONT_LABEL);
    p.textSize(11);
    p.textAlign(p.LEFT, p.CENTER);
    p.text('air in', tubeCenterX + 14, tubeBottomY + 17);
    p.text('air out', tubeCenterX + 14, tubeTopY - 17);
  }

  function drawUpwardArrow(x, tailY, tipY) {
    const headSize = 5;
    p.stroke(COLOR_INK_SOFT());
    p.strokeWeight(1.5);
    p.line(x, tailY, x, tipY);
    p.line(x, tipY, x - headSize, tipY + headSize);
    p.line(x, tipY, x + headSize, tipY + headSize);
    p.strokeWeight(1);
  }

  // The pressure sensor: a transducer tapped into the tube wall at mid-height,
  // on the pressure antinode. It is drawn on the wall itself so it reads as
  // part of the hardware, and it is the single point the trace panel is
  // plotting. The label is pushed sideways, clear of the tracer column running
  // down the tube's axis.
  function drawSensor(tubeGeometry) {
    const { tubeRightX } = tubeGeometry;
    const sensorY = yForNormalizedPosition(SENSOR_NORMALIZED_POSITION, tubeGeometry);

    // Pale collar so the dot stays legible against the wall it straddles.
    p.noStroke();
    p.fill(COLOR_BACKGROUND());
    p.circle(tubeRightX, sensorY, SENSOR_DIAMETER + 6);
    p.fill(COLOR_SENSOR());
    p.circle(tubeRightX, sensorY, SENSOR_DIAMETER);

    p.fill(COLOR_SENSOR());
    p.textFont(FONT_LABEL);
    p.textSize(11);
    p.textAlign(p.LEFT, p.CENTER);
    p.text('sensor', tubeRightX + SENSOR_HORIZONTAL_OFFSET, sensorY);
  }

  // Short reading key along the bottom of the canvas, so none of the colours
  // are left to guesswork: warm = gas squeezed together, cool = gas pulled
  // apart, green = the probe whose signal becomes the graph.
  function drawColorLegend() {
    const items = [
      { swatch: COLOR_COMPRESSION(), label: 'compression, pressure above rest' },
      { swatch: COLOR_RAREFACTION(), label: 'rarefaction, pressure below rest' },
      { swatch: COLOR_TRACER(), label: 'gas parcels, carried by the wave' },
      { swatch: COLOR_SENSOR(), label: 'pressure sensor, plotted at right' }
    ];

    p.textFont(FONT_LABEL);
    p.textSize(11);
    p.textAlign(p.LEFT, p.CENTER);

    const swatchSize = 10;
    const swatchGap = 6;
    const itemGap = 20;

    let totalWidth = -itemGap;
    for (const item of items) {
      totalWidth += swatchSize + swatchGap + p.textWidth(item.label) + itemGap;
    }

    p.rectMode(p.CENTER);
    let cursorX = CANVAS_WIDTH / 2 - totalWidth / 2;
    for (const item of items) {
      p.noStroke();
      p.fill(item.swatch);
      p.rect(cursorX + swatchSize / 2, LEGEND_Y, swatchSize, swatchSize, 2);
      cursorX += swatchSize + swatchGap;

      p.fill(COLOR_INK_SOFT());
      p.text(item.label, cursorX, LEGEND_Y);
      cursorX += p.textWidth(item.label) + itemGap;
    }
    p.rectMode(p.CORNER);
  }

  function drawFrequencyReadout() {
    p.noStroke();
    p.fill(COLOR_INK());
    p.textFont(FONT_MONO);
    p.textSize(13);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(`Natural pitch: ${naturalFrequency.toFixed(2)} Hz`, CANVAS_WIDTH - 12, 12);

    p.textFont(FONT_LABEL);
    p.textAlign(p.LEFT, p.TOP);
    p.fill(COLOR_INK_SOFT());
    p.text('Press Pulse to excite the tube', 12, 12);
  }

  // -------------------------------------------------------------------------
  // Rendering the scrolling trace
  // -------------------------------------------------------------------------

  function drawTracePanel() {
    p.rectMode(p.CORNER);
    p.noStroke();
    p.fill(COLOR_PANEL());
    p.rect(TRACE_LEFT - 20, TRACE_TOP - 24, (TRACE_RIGHT - TRACE_LEFT) + 40, TRACE_HEIGHT + 44, 6);

    p.fill(COLOR_INK_SOFT());
    p.textFont(FONT_LABEL);
    p.textSize(12);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(
      `sensor pressure vs. time, measured at mid-height  (last ${TRACE_SECONDS}s)`,
      TRACE_LEFT - 10,
      TRACE_TOP - 8
    );

    const zeroY = mapPressureToTraceY(0);
    p.stroke(220);
    p.strokeWeight(1);
    p.line(TRACE_LEFT, zeroY, TRACE_RIGHT, zeroY);

    p.noFill();
    p.stroke(COLOR_TRACE());
    p.strokeWeight(2);
    p.beginShape();
    for (let i = 0; i < pressureHistory.length; i++) {
      const x = p.map(i, 0, pressureHistory.length - 1, TRACE_LEFT, TRACE_RIGHT);
      const y = mapPressureToTraceY(pressureHistory[i]);
      p.vertex(x, y);
    }
    p.endShape();

    // Marker at the current (rightmost) sample.
    p.noStroke();
    p.fill(COLOR_ACCENT_WARM());
    const lastY = mapPressureToTraceY(pressureHistory[pressureHistory.length - 1]);
    p.circle(TRACE_RIGHT, lastY, 6);
  }

  function mapPressureToTraceY(pressureValue) {
    return p.map(pressureValue, -TRACE_MAX_PRESSURE, TRACE_MAX_PRESSURE, TRACE_TOP + TRACE_HEIGHT, TRACE_TOP);
  }
};

new p5(sketch);
