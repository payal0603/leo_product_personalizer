/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onMounted, onWillUnmount, onPatched, useRef, useState } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

class DesignAreaWidget extends Component {
    static props = {
        ...standardFieldProps,
    };

    static template = "leo_product_personalizer.DesignAreaWidget";

    setup() {
        this.canvasRef = useRef("canvas");
        this.state = useState({
            initialized: false,
            hasImage: false,
            isRestricted: false,
        });
        this.fabricCanvas = null;
        this.restrictedRect = null;
        this.previousImageId = null;
        this.previousRestricted = null;
        this.isUpdatingFromRect = false;
        
        // Track previous field values
        this.previousBounds = {
            x: null,
            y: null,
            width: null,
            height: null
        };

        onMounted(async () => {
            await this.initCanvas();
        });

        onPatched(async () => {
            // Re-initialize when is_restricted_area or image changes
            const hasImage = !!this.record.data.design_image;
            const isRestricted = this.record.data.is_restricted_area;
            const recordId = this.record.resId;
            
            // Check if image or restriction state changed
            if (this.previousImageId !== recordId || this.previousRestricted !== isRestricted) {
                console.log('Field changed, re-initializing canvas');
                this.previousImageId = recordId;
                this.previousRestricted = isRestricted;
                await this.initCanvas();
            } else if (this.fabricCanvas && this.restrictedRect && !this.isUpdatingFromRect) {
                // Check if bound values changed manually
                this.updateRectFromFields();
            }
        });

        onWillUnmount(() => {
            if (this.fabricCanvas) {
                this.fabricCanvas.dispose();
                this.fabricCanvas = null;
            }
        });
    }

    get record() {
        return this.props.record;
    }

    async initCanvas() {
        await new Promise(resolve => setTimeout(resolve, 150));

        const hasImage = !!this.record.data.design_image;
        const isRestricted = this.record.data.is_restricted_area;
        const recordId = this.record.resId;
                
        this.state.hasImage = hasImage;
        this.state.isRestricted = isRestricted;

        // Dispose existing canvas
        if (this.fabricCanvas) {
            console.log('Disposing existing canvas');
            this.fabricCanvas.dispose();
            this.fabricCanvas = null;
            this.restrictedRect = null;
        }

        if (!hasImage) {
            this.state.initialized = false;
            return;
        }

        if (!isRestricted) {
            this.state.initialized = false;
            return;
        }

        try {
            this.fabricCanvas = new fabric.Canvas(this.canvasRef.el, {
                width: 800,
                height: 800,
                backgroundColor: "#f5f5f5",
            });

            // Load image
            const imageUrl = `/web/image/product.design.config/${recordId}/design_image`;
            
            await this.loadBackgroundImage(imageUrl);            
            this.createRestrictedRect();
            this.setupEvents();

            // Initialize previous bounds
            this.updatePreviousBounds();

            this.state.initialized = true;
        } catch (error) {
            console.error('Error initializing canvas:', error);
        }
    }

    async loadBackgroundImage(imageUrl) {
        return new Promise((resolve, reject) => {
            console.log('Attempting to load image from:', imageUrl);
            fabric.Image.fromURL(imageUrl, (img) => {
                if (!img || !img.width || !img.height) {
                    reject(new Error('Image load failed'));
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
            }, { crossOrigin: 'anonymous' });
        });
    }

    createRestrictedRect() {
        // Get existing values or use defaults
        const x = this.record.data.bound_x || 100;
        const y = this.record.data.bound_y || 100;
        const w = this.record.data.bound_width || 100;
        const h = this.record.data.bound_height || 100;

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
        console.log('Canvas events registered');
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
        
        // Set flag to prevent circular updates
        this.isUpdatingFromRect = true;
        
        const br = this.restrictedRect.getBoundingRect();
        this.record.update({
            bound_x: Math.round(br.left),
            bound_y: Math.round(br.top),
            bound_width: Math.round(br.width),
            bound_height: Math.round(br.height),
        });
        
        this.updatePreviousBounds();
        
        // Reset flag after a short delay
        setTimeout(() => {
            this.isUpdatingFromRect = false;
        }, 100);
    }

    updatePreviousBounds() {
        this.previousBounds = {
            x: this.record.data.bound_x,
            y: this.record.data.bound_y,
            width: this.record.data.bound_width,
            height: this.record.data.bound_height
        };
    }

    updateRectFromFields() {
        const currentBounds = {
            x: this.record.data.bound_x,
            y: this.record.data.bound_y,
            width: this.record.data.bound_width,
            height: this.record.data.bound_height
        };

        // Check if any bound value changed
        const hasChanged = 
            currentBounds.x !== this.previousBounds.x ||
            currentBounds.y !== this.previousBounds.y ||
            currentBounds.width !== this.previousBounds.width ||
            currentBounds.height !== this.previousBounds.height;

        if (!hasChanged) return;

        console.log('Field values changed, updating rectangle');

        // Validate values
        const canvasW = this.fabricCanvas.getWidth();
        const canvasH = this.fabricCanvas.getHeight();

        let x = Math.max(0, currentBounds.x || 0);
        let y = Math.max(0, currentBounds.y || 0);
        let w = Math.max(10, Math.min(currentBounds.width || 100, canvasW));
        let h = Math.max(10, Math.min(currentBounds.height || 100, canvasH));

        // Ensure rect doesn't go outside canvas
        if (x + w > canvasW) x = canvasW - w;
        if (y + h > canvasH) y = canvasH - h;

        // Update the rectangle
        this.restrictedRect.set({
            left: x,
            top: y,
            width: w,
            height: h
        });

        this.restrictedRect.setCoords();
        this.fabricCanvas.renderAll();

        // Update previous bounds
        this.updatePreviousBounds();

        // If values were clamped, update the fields
        if (x !== currentBounds.x || y !== currentBounds.y || 
            w !== currentBounds.width || h !== currentBounds.height) {
            this.isUpdatingFromRect = true;
            this.record.update({
                bound_x: Math.round(x),
                bound_y: Math.round(y),
                bound_width: Math.round(w),
                bound_height: Math.round(h),
            });
            setTimeout(() => {
                this.isUpdatingFromRect = false;
            }, 100);
        }
    }
}

registry.category("fields").add("design_area_widget", {
    component: DesignAreaWidget,
});