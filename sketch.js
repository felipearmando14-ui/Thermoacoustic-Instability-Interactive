
// Thermoacoustic Instability, Demo 1: The Resonator
//
// A combustion chamber's fundamental acoustic mode behaves, to first order,
// like a single damped harmonic oscillator: pulse it and it rings at its own
// natural pitch, then the ringing dies out. There is no heat release and no
// flame here. That arrives in Demo 2, which will reuse `chamber.step()` and
// simply add a heat-release drive term to pressureAcceleration.
//
// The chamber is drawn as "Variant D" from the visualization study: a density
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

  // Fixed physics timestep. We take several small substeps per rendered
  // frame rather than one big step, which keeps the integrator stable even
  // at the higher end of the natural-frequency range.
  const TIME_STEP = 1 / 240;
  const SUBSTEPS_PER_FRAME = 4;

  // Pressure amplitude of a pulse, and the reference the shading saturates
  // against.
  const MAX_PRESSURE = 46;

  // Variant D rendering. Real acoustic displacements are microscopic, so the
  // tracer motion is pure exaggeration: this is how many pixels one unit of
  // pressure amplitude is worth at the peak of the swing.
  const DISPLACEMENT_PIXELS_PER_PRESSURE = 2.0;
  const TRACER_COUNT = 24;
  const TRACER_DIAMETER = 7;
  const SHADING_STRIP_COUNT = 200;

  // Where the pressure sensor is mounted, as a normalized position along the
  // tube: 0 is the left closed end, 1 the right. A closed end is exactly
  // where a real rig puts its pressure transducer: it is a pressure
  // antinode, so it sees the largest signal the mode has to offer, while a
  // probe at the center would sit on the node and read almost nothing.
  const SENSOR_NORMALIZED_POSITION = 0;
  const SENSOR_DIAMETER = 12;
  const SENSOR_VERTICAL_OFFSET = -40; // clear of the tracer row on the centerline

  // Scrolling trace: fixed time window and fixed vertical scale.
  const TRACE_SECONDS = 7;
  const TRACE_MAX_PRESSURE = MAX_PRESSURE;

  // Chamber length is driven by the HTML slider; these mirror its min/max.
  const CHAMBER_LENGTH_MIN = 60;
  const CHAMBER_LENGTH_MAX = 220;

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  const CANVAS_WIDTH = 860;
  const CANVAS_HEIGHT = 520;

  const TUBE_CENTER_Y = 165;
  const TUBE_WALL_HEIGHT = 130;
  const TUBE_MIN_PIXEL_LENGTH = 260;
  const TUBE_MAX_PIXEL_LENGTH = 680;

  const LEGEND_ROW_ONE_Y = 268;
  const LEGEND_ROW_TWO_Y = 290;

  const TRACE_LEFT = 60;
  const TRACE_RIGHT = CANVAS_WIDTH - 60;
  const TRACE_TOP = 340;
  const TRACE_HEIGHT = 150;

  const COLOR_BACKGROUND = () => p.color('#f7f5f0');
  const COLOR_PANEL = () => p.color('#ffffff');
  const COLOR_INK = () => p.color('#23241f');
  const COLOR_INK_SOFT = () => p.color('#5b5d54');
  const COLOR_WALL = () => p.color('#3a3b34');
  const COLOR_ACCENT_WARM = () => p.color('#d9762b');

  // The sensor and the trace it feeds share one colour, so the green dot on
  // the wall and the green curve below read as the same instrument.
  const COLOR_SENSOR = () => p.color('#1f9254');
  const COLOR_TRACE = () => COLOR_SENSOR();

  // Variant D palette. Neutral is the gas at rest, so an un-pulsed chamber
  // reads as "nothing happening" rather than as a colour.
  const COLOR_GAS_NEUTRAL = () => p.color('#f2efe9');
  const COLOR_COMPRESSION = () => p.color('#b3401f'); // warm: pressure above rest
  const COLOR_RAREFACTION = () => p.color('#4a90c4'); // cool: pressure below rest
  const COLOR_TRACER = () => p.color('#23241f');

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
      // chamber's natural frequency.
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

  let chamberLengthSlider, pulseButton;

  // -------------------------------------------------------------------------
  // p5 lifecycle
  // -------------------------------------------------------------------------

  p.setup = () => {
    const canvas = p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    canvas.parent('canvas-holder');

    const traceSampleCount = Math.round(TRACE_SECONDS * 60); // ~60 frames/sec
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

    for (let substep = 0; substep < SUBSTEPS_PER_FRAME; substep++) {
      chamber.step(TIME_STEP);
    }

    // The trace plots what the sensor sees, not the raw modal amplitude:
    // it samples the pressure field at the sensor's own position.
    pressureHistory.push(localPressureAt(SENSOR_NORMALIZED_POSITION));
    pressureHistory.shift();

    p.background(COLOR_BACKGROUND());
    const tubeGeometry = getTubeGeometry();
    drawDensityShading(tubeGeometry);
    drawTracerParticles(tubeGeometry);
    drawTube(tubeGeometry);
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
  // Mode shapes for the fundamental of a CLOSED-CLOSED chamber
  //
  // normalizedPosition runs 0..1 from the left wall to the right wall.
  // Pressure is the spatial derivative of displacement, which is why the two
  // peak in different places:
  //   - displacement / velocity is pinned to zero at both rigid walls (the
  //     gas cannot move through them) and is maximum at the center, where
  //     the column is free to slosh back and forth.
  //   - pressure is maximum at the walls, where the gas piles up against a
  //     surface it cannot pass, and zero at the center, a pressure node
  //     exactly where the displacement antinode sits.
  // -------------------------------------------------------------------------

  function displacementShape(normalizedPosition) {
    return Math.sin(Math.PI * normalizedPosition);
  }

  function pressureShape(normalizedPosition) {
    return Math.cos(Math.PI * normalizedPosition);
  }

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  function getTubeGeometry() {
    const tubePixelLength = p.map(
      chamberLength,
      CHAMBER_LENGTH_MIN, CHAMBER_LENGTH_MAX,
      TUBE_MIN_PIXEL_LENGTH, TUBE_MAX_PIXEL_LENGTH
    );
    const tubeLeftX = CANVAS_WIDTH / 2 - tubePixelLength / 2;
    const tubeRightX = CANVAS_WIDTH / 2 + tubePixelLength / 2;
    return { tubePixelLength, tubeLeftX, tubeRightX };
  }

  // -------------------------------------------------------------------------
  // Rendering the chamber (Variant D: shading + tracer particles)
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

  function drawDensityShading(tubeGeometry) {
    const { tubeLeftX, tubePixelLength } = tubeGeometry;
    const tubeTopY = TUBE_CENTER_Y - TUBE_WALL_HEIGHT / 2;
    const stripWidth = tubePixelLength / SHADING_STRIP_COUNT + 1; // +1 avoids hairline seams

    p.rectMode(p.CORNER);
    p.noStroke();
    for (let i = 0; i < SHADING_STRIP_COUNT; i++) {
      const normalizedPosition = (i + 0.5) / SHADING_STRIP_COUNT;
      p.fill(pressureToShadingColor(localPressureAt(normalizedPosition)));
      p.rect(tubeLeftX + (i / SHADING_STRIP_COUNT) * tubePixelLength, tubeTopY, stripWidth, TUBE_WALL_HEIGHT);
    }
  }

  // Tracer displacement amplitude, in pixels.
  //
  // pressureVelocity drives the offset (not pressure) so the tracers move
  // fastest as the wave passes through zero pressure. Dividing by
  // angularFrequency makes the swing track the wave's pressure amplitude
  // rather than its pitch, so shortening the chamber raises the tone without
  // silently enlarging the gas motion.
  //
  // The result is capped at 0.9 * tubePixelLength / PI. A tracer at u has
  // (1-u) * length of room before the far wall and moves amplitude*sin(PI*u);
  // near the wall sin(PI*u) -> PI*(1-u), so the two balance exactly at
  // amplitude = length / PI, the point where neighbouring tracers collide
  // and the density formally diverges. Capping just below it keeps every
  // tracer inside the closed chamber, and because it scales all of them by
  // the same factor the sin(PI*u) mode shape is preserved.
  function tracerAmplitudePixels(tubePixelLength) {
    const requestedAmplitude =
      DISPLACEMENT_PIXELS_PER_PRESSURE * chamber.pressureVelocity / chamber.angularFrequency;
    const maxAmplitude = 0.9 * tubePixelLength / Math.PI;
    return p.constrain(requestedAmplitude, -maxAmplitude, maxAmplitude);
  }

  // The tracers are advected, not painted: each one only ever moves sideways
  // from its own rest position. The crowding and thinning you see is a
  // consequence of that motion, not something drawn on top of it.
  function drawTracerParticles(tubeGeometry) {
    const { tubeLeftX, tubeRightX, tubePixelLength } = tubeGeometry;
    const amplitudePixels = tracerAmplitudePixels(tubePixelLength);
    const wallMargin = TRACER_DIAMETER / 2;

    p.noStroke();
    p.fill(COLOR_TRACER());
    for (const restPosition of tracerRestPositions) {
      const offsetPixels = amplitudePixels * displacementShape(restPosition);
      const drawnX = p.constrain(
        tubeLeftX + restPosition * tubePixelLength + offsetPixels,
        tubeLeftX + wallMargin,
        tubeRightX - wallMargin
      );
      p.circle(drawnX, TUBE_CENTER_Y, TRACER_DIAMETER);
    }
  }

  function drawTube(tubeGeometry) {
    const { tubeLeftX, tubeRightX } = tubeGeometry;

    // Static duct outline: the physical container, independent of pressure.
    p.noFill();
    p.stroke(COLOR_INK_SOFT());
    p.strokeWeight(1.5);
    p.rectMode(p.CORNERS);
    p.rect(tubeLeftX, TUBE_CENTER_Y - TUBE_WALL_HEIGHT / 2, tubeRightX, TUBE_CENTER_Y + TUBE_WALL_HEIGHT / 2, 4);

    // End walls, drawn heavier so the chamber reads as closed at both ends.
    p.stroke(COLOR_WALL());
    p.strokeWeight(7);
    const wallOverhang = 14;
    p.line(tubeLeftX, TUBE_CENTER_Y - TUBE_WALL_HEIGHT / 2 - wallOverhang, tubeLeftX, TUBE_CENTER_Y + TUBE_WALL_HEIGHT / 2 + wallOverhang);
    p.line(tubeRightX, TUBE_CENTER_Y - TUBE_WALL_HEIGHT / 2 - wallOverhang, tubeRightX, TUBE_CENTER_Y + TUBE_WALL_HEIGHT / 2 + wallOverhang);

    p.strokeWeight(1);
  }

  // The pressure sensor: a transducer mounted in the closed end wall. It is
  // drawn on top of the wall so it reads as part of the hardware, and it is
  // the single point the trace panel below is plotting.
  function drawSensor(tubeGeometry) {
    const { tubeLeftX, tubeRightX, tubePixelLength } = tubeGeometry;
    const sensorX = tubeLeftX + SENSOR_NORMALIZED_POSITION * tubePixelLength;
    const sensorY = TUBE_CENTER_Y + SENSOR_VERTICAL_OFFSET;

    // Pale collar so the dot stays legible against the dark end wall.
    p.noStroke();
    p.fill(COLOR_BACKGROUND());
    p.circle(sensorX, sensorY, SENSOR_DIAMETER + 6);
    p.fill(COLOR_SENSOR());
    p.circle(sensorX, sensorY, SENSOR_DIAMETER);

    // Label sits outside the chamber so it never covers the gas.
    const labelIsOnLeft = SENSOR_NORMALIZED_POSITION < 0.5;
    p.fill(COLOR_SENSOR());
    p.textFont('Helvetica');
    p.textSize(11);
    p.textAlign(labelIsOnLeft ? p.RIGHT : p.LEFT, p.CENTER);
    p.text(
      'sensor',
      labelIsOnLeft ? tubeLeftX - 14 : tubeRightX + 14,
      sensorY
    );
  }

  // Short reading key, so none of the colours are left to guesswork:
  // warm = gas squeezed together, cool = gas pulled apart, green = the probe
  // whose signal becomes the graph.
  function drawColorLegend() {
    const rows = [
      [
        { swatch: COLOR_COMPRESSION(), label: 'compression, pressure above rest' },
        { swatch: COLOR_RAREFACTION(), label: 'rarefaction, pressure below rest' }
      ],
      [
        { swatch: COLOR_TRACER(), label: 'gas parcels, carried by the wave' },
        { swatch: COLOR_SENSOR(), label: 'pressure sensor, its signal is the graph below' }
      ]
    ];
    const rowCenterY = [LEGEND_ROW_ONE_Y, LEGEND_ROW_TWO_Y];

    p.textFont('Helvetica');
    p.textSize(12);
    p.textAlign(p.LEFT, p.CENTER);

    const swatchSize = 11;
    const swatchGap = 7;
    const itemGap = 30;

    p.rectMode(p.CENTER);
    rows.forEach((items, rowIndex) => {
      const centerY = rowCenterY[rowIndex];

      let totalWidth = -itemGap;
      for (const item of items) {
        totalWidth += swatchSize + swatchGap + p.textWidth(item.label) + itemGap;
      }

      let cursorX = CANVAS_WIDTH / 2 - totalWidth / 2;
      for (const item of items) {
        p.noStroke();
        p.fill(item.swatch);
        p.rect(cursorX + swatchSize / 2, centerY, swatchSize, swatchSize, 2);
        cursorX += swatchSize + swatchGap;

        p.fill(COLOR_INK_SOFT());
        p.text(item.label, cursorX, centerY);
        cursorX += p.textWidth(item.label) + itemGap;
      }
    });
    p.rectMode(p.CORNER);
  }

  function drawFrequencyReadout() {
    p.noStroke();
    p.fill(COLOR_INK());
    p.textFont('Helvetica');
    p.textSize(13);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(`Natural pitch: ${naturalFrequency.toFixed(2)} Hz`, CANVAS_WIDTH - 12, 12);
    p.textAlign(p.LEFT, p.TOP);
    p.fill(COLOR_INK_SOFT());
    p.text('Press Pulse to excite the chamber', 12, 12);
  }

  // -------------------------------------------------------------------------
  // Rendering the scrolling trace
  // -------------------------------------------------------------------------

  function drawTracePanel() {
    p.rectMode(p.CORNER); // drawTube() leaves rectMode set to CORNERS
    p.noStroke();
    p.fill(COLOR_PANEL());
    p.rect(TRACE_LEFT - 20, TRACE_TOP - 24, (TRACE_RIGHT - TRACE_LEFT) + 40, TRACE_HEIGHT + 44, 6);

    p.fill(COLOR_INK_SOFT());
    p.textSize(12);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(
      `sensor pressure vs. time, measured at the closed end  (last ${TRACE_SECONDS}s)`,
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
