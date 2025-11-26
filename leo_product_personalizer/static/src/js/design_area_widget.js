/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onMounted, onWillUnmount, useRef, useState } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

class DesignAreaWidget extends Component {
    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.canvasRef = useRef("canvas");
        this.state = useState({
            initialized: false,
            hasImage: false,
            isRestricted: false,
        });
        this.fabricCanvas = null;
        this.restrictedRect = null;

        onMounted(() => {
            debugger;
            this.initCanvas();
        });

        onWillUnmount(() => {
            if (this.fabricCanvas) {
                this.fabricCanvas.dispose();
            }
        });
    }

    get record() {
        return this.props.record;
    }

    async initCanvas() {
        debugger;
        if (!this.canvasRef.el) return;

        const imageData = this.record.data.design_image;
        const isRestricted = this.record.data.is_restricted_area;
        this.state.hasImage = !!imageData;
        this.state.isRestricted = isRestricted;

        if (!imageData || !isRestricted) {
            return;
        }

        // Wait for fabric.js to be available
        if (typeof fabric === 'undefined') {
            console.error('Fabric.js not loaded');
            return;
        }

        this.fabricCanvas = new fabric.Canvas(this.canvasRef.el, {
            width: 800,
            height: 800,
            backgroundColor: "#f5f5f5",
        });

        await this.loadBackgroundImage(imageData);
        this.createRestrictedRect();
        this.setupEvents();

        this.state.initialized = true;
    }

    async loadBackgroundImage(imageData) {
        const imageUrl = `data:image/png;base64,${imageData}`;

        return new Promise((resolve) => {
            fabric.Image.fromURL(imageUrl, (img) => {
                if (!img) {
                    resolve();
                    return;
                }

                const w = this.fabricCanvas.getWidth();
                const h = this.fabricCanvas.getHeight();
                const scale = Math.min(w / img.width, h / img.height);

                img.set({
                    left: (w - img.width * scale) / 2,
                    top: (h - img.height * scale) / 2,
                    scaleX: scale,
                    scaleY: scale,
                    selectable: false,
                    evented: false,
                });

                this.fabricCanvas.setBackgroundImage(
                    img,
                    this.fabricCanvas.renderAll.bind(this.fabricCanvas)
                );
                resolve();
            });
        });
    }

    createRestrictedRect() {
        const x = this.record.data.bound_x || 100;
        const y = this.record.data.bound_y || 100;
        const w = this.record.data.bound_width || 300;
        const h = this.record.data.bound_height || 300;

        this.restrictedRect = new fabric.Rect({
            left: x,
            top: y,
            width: w,
            height: h,
            fill: "rgba(0, 150, 255, 0.2)",
            stroke: "#0096FF",
            strokeWidth: 3,
            strokeDashArray: [10, 5],
            cornerColor: "#0096FF",
            cornerSize: 14,
            transparentCorners: false,
            cornerStyle: "circle",
            borderColor: "#0096FF",
            lockRotation: true,
            hasRotatingPoint: false,
        });

        this.fabricCanvas.add(this.restrictedRect);
        this.fabricCanvas.setActiveObject(this.restrictedRect);
        this.fabricCanvas.renderAll();
    }

    setupEvents() {
        this.fabricCanvas.on("object:modified", () => this.onRectModified());
        this.fabricCanvas.on("object:moving", () => this.clampRect());
        this.fabricCanvas.on("object:scaling", () => this.clampRect());
    }

    clampRect() {
        if (!this.restrictedRect) return;

        const rect = this.restrictedRect;
        const canvasW = this.fabricCanvas.getWidth();
        const canvasH = this.fabricCanvas.getHeight();

        rect.setCoords();
        const br = rect.getBoundingRect();

        let left = rect.left;
        let top = rect.top;

        if (br.left < 0) left -= br.left;
        if (br.top < 0) top -= br.top;
        if (br.left + br.width > canvasW) {
            left -= br.left + br.width - canvasW;
        }
        if (br.top + br.height > canvasH) {
            top -= br.top + br.height - canvasH;
        }

        rect.set({ left, top });
        rect.setCoords();
        this.fabricCanvas.renderAll();
    }

    onRectModified() {
        if (!this.restrictedRect) return;

        const br = this.restrictedRect.getBoundingRect();

        this.record.update({
            bound_x: Math.round(br.left),
            bound_y: Math.round(br.top),
            bound_width: Math.round(br.width),
            bound_height: Math.round(br.height),
        });
    }
}

DesignAreaWidget.template = "leo_product_personalizer.DesignAreaWidget";

registry.category("fields").add("design_area_widget", {
    component: DesignAreaWidget,
});