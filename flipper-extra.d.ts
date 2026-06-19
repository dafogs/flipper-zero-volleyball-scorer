// Ambient module shim.
//
// The bundled @flipperdevices/fz-sdk@0.1.3 predates the `widget` view, but the
// device firmware (1.4.3) has had it since JS SDK 1.0. Declaring the module
// here lets `tsc` accept the import; esbuild keeps it external, so at runtime
// the firmware resolves `require("@flipperdevices/fz-sdk/gui/widget")` itself.
//
// Typed loosely on purpose (the splash builds widget elements via plain
// objects); ground truth is firmware modules/js_gui/widget.c.
declare module "@flipperdevices/fz-sdk/gui/widget" {
    const factory: any;
    export = factory;
}
