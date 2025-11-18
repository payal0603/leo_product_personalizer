/** @odoo-module **/

import publicWidget from '@web/legacy/js/public/public_widget';
import { rpc } from '@web/core/network/rpc';

publicWidget.registry.ProductPagePersonalization = publicWidget.Widget.extend({
    selector: '.oe_website_sale:not(.o_product_personalize_page)',
    events: {
        'click #customize_product_button': '_onClickCustomizeProduct',
    },

    _onClickCustomizeProduct: function (ev) {
        ev.preventDefault();
        const productId = this.$('input[name="product_template_id"]').val();
        window.location.href = `/shop/personalize/${productId}`;
    },
});

publicWidget.registry.ProductPersonalizationEditor = publicWidget.Widget.extend({
    selector: '.o_product_personalize_page',
    events: {
        'click #add_text_button': '_onClickAddText',
        'click #add_image_button': '_onClickAddImage',
        'click #add_shape_button': '_onClickAddShape',
        'click #add_to_cart_personalized': '_onClickAddToCartPersonalized',
        'click #undo_button': '_onClickUndo',
        'click #redo_button': '_onClickRedo',
        'click #delete_button': '_onClickDelete',
        'change #text_font_family': '_onChangeTextProperty',
        'change #text_font_size': '_onChangeTextProperty',
        'change #text_color': '_onChangeTextProperty',
        'click #text_bold': '_onClickTextStyle',
        'click #text_italic': '_onClickTextStyle',
        'click #text_underline': '_onClickTextStyle',
        'click #text_align_left': '_onClickTextAlign',
        'click #text_align_center': '_onClickTextAlign',
        'click #text_align_right': '_onClickTextAlign',
        'change #shape_fill_color': '_onChangeShapeProperty',
        'change #shape_stroke_color': '_onChangeShapeProperty',
        'change #shape_stroke_width': '_onChangeShapeProperty',
        'click #bring_to_front': '_onClickLayerAction',
        'click #send_to_back': '_onClickLayerAction',
        'click #duplicate_object': '_onClickDuplicate',
        'click #lock_object': '_onClickLock',
        'click .preset-color': '_onClickPresetColor',
        // --- ADDED: design type selector change
        'change #design_type_selector': '_onDesignTypeChange',
    },

    start: function () {
        debugger
        this.history = [];
        this.historyStep = -1;
        this.isUndoRedoAction = false;
        // --- ADDED: multi-side state
        this.designData = {};            // stores fabric JSON per design type
        this.activeDesignType = null;    // current active side string
        this.zone = null;                // {x,y,width,height} px or null
        this.zoneRect = null;            // fabric.Rect instance for UI
        this.productData = null;         // data from server

        return this._super.apply(this, arguments).then(async () => {
            await this._loadProductData();        // populates this.productData
            this._initializeCanvas();
            this._setupEventListeners();
            this._setupKeyboardShortcuts();
            this._initDesignTypeSelector();      // create/populate selector and set default
        });
    },

    /**************************************************************************
     * Canvas initialization & basic product loading (mostly unchanged)
     **************************************************************************/

    _initializeCanvas: function () {
        const wrapper = document.getElementById("canvas_wrapper");
        if (!wrapper) return console.error("canvas_wrapper not found");

        wrapper.innerHTML = "";
        const canvas = document.createElement("canvas");
        canvas.id = "personalization_canvas";
        Object.assign(canvas, { width: 800, height: 800 });
        Object.assign(canvas.style, { width: "800px", height: "800px", border: "2px solid #dee2e6" });
        wrapper.appendChild(canvas);

        this.fabricCanvas = new fabric.Canvas("personalization_canvas");
        // NOTE: background loaded via per-side loader
    },

    _setupEventListeners: function () {
        this.fabricCanvas.on({
            'selection:created': () => this._updateControls(),
            'selection:updated': () => this._updateControls(),
            'selection:cleared': () => this._hideControls(),
            'object:added': (e) => { if (!this.isUndoRedoAction) this._saveState(); this._onObjectAdded(e && e.target); },
            'object:modified': (e) => { if (!this.isUndoRedoAction) this._saveState(); this._clampObjectToZone(e && e.target); },
            'object:removed': () => !this.isUndoRedoAction && this._saveState()
        });

        // lightweight checks during transform to avoid objects flying off screen while dragging
        this.fabricCanvas.on('object:moving', (e) => this._ensureObjectWithinCanvas(e.target));
        this.fabricCanvas.on('object:scaling', (e) => this._ensureObjectWithinCanvas(e.target));
        this.fabricCanvas.on('object:rotating', (e) => this._ensureObjectWithinCanvas(e.target));
    },

    _ensureObjectWithinCanvas: function (obj) {
        if (!obj) return;
        // minimal no-op that avoids drastic mid-transform changes:
        // ensure the object bbox stays inside canvas bounds (not zone) to avoid negative positions.
        const br = obj.getBoundingRect(true, true);
        const cw = this.fabricCanvas.getWidth();
        const ch = this.fabricCanvas.getHeight();
        let changed = false;
        if (br.left < 0) { obj.left += (0 - br.left); changed = true; }
        if (br.top < 0) { obj.top += (0 - br.top); changed = true; }
        if (br.left + br.width > cw) { obj.left -= (br.left + br.width - cw); changed = true; }
        if (br.top + br.height > ch) { obj.top -= (br.top + br.height - ch); changed = true; }
        if (changed) obj.setCoords();
    },

    _onObjectAdded: function (obj) {
        if (!obj) return;
        // If there is an active restricted zone, position new objects inside it
        if (this.zone) {
            // center inside zone with small padding
            const cx = this.zone.bound_x + (this.zone.width / 2);
            const cy = this.zone.bound_y + (this.zone.height / 2);
            obj.set({ left: cx, top: cy });
            // fit object to zone a bit if it's too large
            const br = obj.getBoundingRect(true, true);
            if (br.width > this.zone.width) {
                const scale = (this.zone.width - 20) / (obj.width || 1);
                obj.scaleX = Math.min(obj.scaleX || 1, scale);
            }
            if (br.height > this.zone.height) {
                const scale = (this.zone.height - 20) / (obj.height || 1);
                obj.scaleY = Math.min(obj.scaleY || 1, scale);
            }
            obj.setCoords();
            if (this.zoneRect) this.zoneRect.bringToFront();
            this.fabricCanvas.renderAll();
        }
    },

    _clampDuringMove: function (obj) {
        if (!this.zone) return;

        let br = obj.getBoundingRect(true, true);

        if (br.left < this.zone.bound_x ||
            br.top < this.zone.bound_y ||
            br.left + br.width > this.zone.bound_x + this.zone.width ||
            br.top + br.height > this.zone.bound_y + this.zone.height
        ) {
            obj.setCoords();
        }
    },

    _setupKeyboardShortcuts: function () {
        $(document).on('keydown', (e) => {
            if ($(e.target).is('input, textarea')) return;

            const obj = this.fabricCanvas.getActiveObject();

            if ((e.key === 'Delete' || e.key === 'Backspace') && obj) {
                e.preventDefault();
                this._deleteActiveObject();
            } else if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    e.preventDefault();
                    e.shiftKey ? this._onClickRedo() : this._onClickUndo();
                } else if (e.key === 'y') {
                    e.preventDefault();
                    this._onClickRedo();
                } else if (e.key === 'd' && obj) {
                    e.preventDefault();
                    this._onClickDuplicate();
                }
            }
        });
    },

    _loadProductData: function () {
        this.productId = parseInt(this.$('#product_id').val());
        return rpc('/shop/product_personalization_data', { product_id: this.productId })
            .then(data => {
                this.productData = data || {};
                if (!data) {
                    console.error('Missing product data');
                }
                return data;
            })
            .catch(error => {
                console.error('Failed to load product data:', error);
                alert('Failed to load product data. Please refresh.');
                throw error;
            });
    },

    /**************************************************************************
     * Controls UI update / history (unchanged)
     **************************************************************************/

    _saveState: function () {
        try {
            this.history = this.history.slice(0, this.historyStep + 1);
            this.history.push(JSON.stringify(this.fabricCanvas.toJSON()));
            this.historyStep++;
            this._updateHistoryButtons();
        } catch (e) {
            console.error('saveState error', e);
        }
    },

    _updateHistoryButtons: function () {
        this.$('#undo_button').prop('disabled', this.historyStep <= 0);
        this.$('#redo_button').prop('disabled', this.historyStep >= this.history.length - 1);
    },

    _onClickUndo: function () {
        if (this.historyStep > 0) {
            this.historyStep--;
            this._loadHistoryState();
        }
    },

    _onClickRedo: function () {
        if (this.historyStep < this.history.length - 1) {
            this.historyStep++;
            this._loadHistoryState();
        }
    },

    _loadHistoryState: function () {
        this.isUndoRedoAction = true;
        const bg = this.fabricCanvas.backgroundImage;

        this.fabricCanvas.loadFromJSON(this.history[this.historyStep], () => {
            if (bg) this.fabricCanvas.setBackgroundImage(bg, this.fabricCanvas.renderAll.bind(this.fabricCanvas));
            this.fabricCanvas.renderAll();
            this.isUndoRedoAction = false;
            this._updateHistoryButtons();
        });
    },

    _onClickDelete: function () {
        this._deleteActiveObject();
    },

    _deleteActiveObject: function () {
        const obj = this.fabricCanvas.getActiveObject();
        if (obj) {
            this.fabricCanvas.remove(obj);
            this.fabricCanvas.renderAll();
        }
    },

    _updateControls: function () {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj) return this._hideControls();

        const isText = obj.type === 'i-text' || obj.type === 'text';
        const isImage = obj.type === 'image';

        this.$('#text_controls').toggle(isText);
        this.$('#shape_controls').toggle(!isText && !isImage);
        this.$('#layer_controls').show();

        if (isText) {
            this.$('#text_font_family').val(obj.fontFamily || 'Arial');
            this.$('#text_font_size').val(obj.fontSize || 40);
            this.$('#text_color').val(this._toHex(obj.fill));
            this.$('#text_bold').toggleClass('active', obj.fontWeight === 'bold');
            this.$('#text_italic').toggleClass('active', obj.fontStyle === 'italic');
            this.$('#text_underline').toggleClass('active', obj.underline);
        } else if (!isImage) {
            this.$('#shape_fill_color').val(this._toHex(obj.fill));
            this.$('#shape_stroke_color').val(this._toHex(obj.stroke));
            this.$('#shape_stroke_width').val(obj.strokeWidth || 2);
        }

        this.$('#lock_object').toggleClass('active', obj.lockMovementX);
    },

    _hideControls: function () {
        this.$('#text_controls, #shape_controls, #layer_controls').hide();
    },

    _toHex: function (color) {
        if (!color || color.startsWith('#')) return color || '#000000';
        const rgb = color.match(/\d+/g);
        if (!rgb || rgb.length < 3) return '#000000';
        return '#' + rgb.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
    },

    _deleteActiveObject: function () {
        const obj = this.fabricCanvas.getActiveObject();
        if (obj) {
            this.fabricCanvas.remove(obj);
            this.fabricCanvas.renderAll();
        }
    },

    /**************************************************************************
     * Add objects (text/image/shape) - unchanged from your original
     **************************************************************************/

    _onClickAddText: function () {
        if (!this.fabricCanvas) return alert('Canvas not ready');

        const text = this.$('#personalization_text').val().trim();
        if (!text) return alert('Please enter some text');

        const textObj = new fabric.IText(text, {
            left: 100,
            top: 100,
            fontFamily: 'Arial',
            fill: '#000000',
            fontSize: 40
        });

        this.fabricCanvas.add(textObj);
        this.fabricCanvas.setActiveObject(textObj);
        this.fabricCanvas.renderAll();
        this.$('#personalization_text').val('');
    },

    _onChangeTextProperty: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj || (obj.type !== 'i-text' && obj.type !== 'text')) return;

        const prop = {
            'text_font_family': ['fontFamily', ev.target.value],
            'text_font_size': ['fontSize', parseInt(ev.target.value)],
            'text_color': ['fill', ev.target.value]
        }[ev.target.id];

        if (prop) {
            obj.set(prop[0], prop[1]);
            this.fabricCanvas.renderAll();
        }
    },

    _onClickTextStyle: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj || (obj.type !== 'i-text' && obj.type !== 'text')) return;

        const style = {
            'text_bold': ['fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold'],
            'text_italic': ['fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic'],
            'text_underline': ['underline', !obj.underline]
        }[ev.target.id];

        if (style) {
            obj.set(style[0], style[1]);
            $(ev.currentTarget).toggleClass('active');
            this.fabricCanvas.renderAll();
        }
    },

    _onClickTextAlign: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (obj && (obj.type === 'i-text' || obj.type === 'text')) {
            obj.set('textAlign', ev.target.id.replace('text_align_', ''));
            this.fabricCanvas.renderAll();
        }
    },

    _onClickAddImage: function () {
        if (!this.fabricCanvas) return alert('Canvas not ready');

        const files = this.$('#personalization_image_upload')[0].files;
        if (!files?.length) return alert('Please select an image file');

        Array.from(files).forEach((file, i) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                fabric.Image.fromURL(e.target.result, (img) => {
                    if (!img) return;
                    img.scaleToWidth(150);
                    img.set({ left: 100 + i * 20, top: 100 + i * 20 });
                    this.fabricCanvas.add(img);
                    this.fabricCanvas.setActiveObject(img);
                    this.fabricCanvas.renderAll();
                });
            };
            reader.readAsDataURL(file);
        });

        this.$('#personalization_image_upload').val('');
    },

    _onClickAddShape: function () {
        if (!this.fabricCanvas) return alert('Canvas not ready');

        const props = { left: 100, top: 100, fill: '#3b82f6', stroke: '#1e40af', strokeWidth: 2 };
        const shapes = {
            rect: () => new fabric.Rect({ ...props, width: 100, height: 100 }),
            square: () => new fabric.Rect({ ...props, width: 100, height: 100 }),
            circle: () => new fabric.Circle({ ...props, radius: 50 }),
            ellipse: () => new fabric.Ellipse({ ...props, rx: 60, ry: 40 }),
            triangle: () => new fabric.Triangle({ ...props, width: 100, height: 100 }),
            line: () => new fabric.Line([50, 50, 200, 50], { ...props, fill: null, strokeWidth: 4 }),
            polygon: () => new fabric.Polygon([{ x: 50, y: 0 }, { x: 100, y: 38 }, { x: 82, y: 100 }, { x: 18, y: 100 }, { x: 0, y: 38 }], props),
            star: () => {
                const pts = [];
                for (let i = 0; i < 10; i++) {
                    const r = i % 2 ? 25 : 50;
                    const a = (i * Math.PI) / 5;
                    pts.push({ x: 50 + r * Math.sin(a), y: 50 - r * Math.cos(a) });
                }
                return new fabric.Polygon(pts, props);
            },
            heart: () => new fabric.Path('M 50,30 C 50,20 40,10 30,10 C 20,10 10,20 10,30 C 10,50 30,70 50,90 C 70,70 90,50 90,30 C 90,20 80,10 70,10 C 60,10 50,20 50,30 Z', { ...props, scaleX: 0.8, scaleY: 0.8 }),
            arrow: () => new fabric.Path('M 10,50 L 60,50 L 60,30 L 90,55 L 60,80 L 60,60 L 10,60 Z', props),
            hexagon: () => new fabric.Polygon(Array.from({ length: 6 }, (_, i) => ({
                x: 50 + 50 * Math.cos(Math.PI / 3 * i),
                y: 50 + 50 * Math.sin(Math.PI / 3 * i)
            })), props),
            diamond: () => new fabric.Polygon([{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }], props)
        };

        const shape = shapes[this.$('#personalization_shape').val()]?.();
        if (shape) {
            this.fabricCanvas.add(shape);
            this.fabricCanvas.setActiveObject(shape);
            this.fabricCanvas.renderAll();
        }
    },

    _onChangeShapeProperty: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj || obj.type === 'i-text' || obj.type === 'text' || obj.type === 'image') return;

        const prop = {
            'shape_fill_color': ['fill', ev.target.value],
            'shape_stroke_color': ['stroke', ev.target.value],
            'shape_stroke_width': ['strokeWidth', parseInt(ev.target.value)]
        }[ev.target.id];

        if (prop) {
            obj.set(prop[0], prop[1]);
            this.fabricCanvas.renderAll();
        }
    },

    _onClickLayerAction: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj) return;

        if (ev.target.id === 'bring_to_front') this.fabricCanvas.bringToFront(obj);
        else if (ev.target.id === 'send_to_back') this.fabricCanvas.sendToBack(obj);

        this.fabricCanvas.renderAll();
    },

    _onClickDuplicate: function () {
        const obj = this.fabricCanvas.getActiveObject();
        if (obj) {
            obj.clone((cloned) => {
                cloned.set({ left: cloned.left + 20, top: cloned.top + 20 });
                this.fabricCanvas.add(cloned);
                this.fabricCanvas.setActiveObject(cloned);
                this.fabricCanvas.renderAll();
            });
        }
    },

    _onClickLock: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (obj) {
            const locked = !obj.lockMovementX;
            obj.set({
                lockMovementX: locked,
                lockMovementY: locked,
                lockRotation: locked,
                lockScalingX: locked,
                lockScalingY: locked,
            });
            $(ev.currentTarget).toggleClass('active');
            this.fabricCanvas.renderAll();
        }
    },

    _onClickPresetColor: function (ev) {
        const color = $(ev.currentTarget).data('color');
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj) return;

        if (obj.type === 'i-text' || obj.type === 'text') {
            obj.set('fill', color);
            this.$('#text_color').val(color);
        } else if (obj.type !== 'image') {
            obj.set('fill', color);
            this.$('#shape_fill_color').val(color);
        }

        this.fabricCanvas.renderAll();
    },

    /**************************************************************************
     * Multi-side switching & load/save
     **************************************************************************/

    // Initialize or populate design type selector in template
    _initDesignTypeSelector: function () {
        const sel = this.$('#design_type_selector');
        // If selector doesn't exist in template, create and append it
        if (!sel.length) {
            const container = $('<div class="design-type-wrap mb-2"><select id="design_type_selector" class="form-control" /></div>');
            // place before canvas wrapper if available
            $('#canvas_wrapper').before(container);
        }
        const $selector = this.$('#design_type_selector');

        // populate options from productData.design_types or from productData.designs keys
        const types = (this.productData && this.productData.design_types && this.productData.design_types.length) ?
            this.productData.design_types : (this.productData && this.productData.designs ? Object.keys(this.productData.designs) : []);
        $selector.empty();
        types.forEach(t => {
            $selector.append(`<option value="${t}">${t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>`);
        });

        // set default active design type
        const defaultType = (this.productData && this.productData.default_design_type) || types[0] || 'front';
        this.activeDesignType = defaultType;
        $selector.val(defaultType);

        // load that side
        this._loadDesignType(defaultType);
    },

    // Called when selector changed
    _onDesignTypeChange: function (ev) {
        const newType = ev.target.value;
        if (!newType || newType === this.activeDesignType) return;
        this._saveCurrentSideState();
        this.activeDesignType = newType;
        this._loadDesignType(newType);
    },

    // Save current fabric JSON for the active side in memory
    _saveCurrentSideState: function () {
        try {
            if (!this.activeDesignType) return;
            this.designData[this.activeDesignType] = this.fabricCanvas.toJSON();
        } catch (e) {
            console.error('Could not save current canvas JSON', e);
        }
    },

    // Load background and zone for given design type and restore saved JSON if exists
    _loadDesignType: function (designType) {
        // productData may already include designs map
        const designs = (this.productData && this.productData.designs) ? this.productData.designs : {};
        const side = designs[designType];

        // if no side config found: use fallback_image_url (product image)
        if (!side) {
            if (this.productData && this.productData.fallback_image_url) {
                this._setBackgroundFromUrl(this.productData.fallback_image_url, () => {
                    this._setZone(null);
                    this._restoreSavedJson(designType);
                });
            } else {
                // clear background
                this.fabricCanvas.setBackgroundImage(null, this.fabricCanvas.renderAll.bind(this.fabricCanvas));
                this._setZone(null);
                this._restoreSavedJson(designType);
            }
            return;
        }

        // load side image if present
        if (side.image_url) {
            this._setBackgroundFromUrl(side.image_url, () => {
                if (side.is_restricted_area) {
                    this._setZone({ x: side.bound_x, y: side.bound_y, width: side.width, height: side.height });
                } else {
                    this._setZone(null);
                }
                this._restoreSavedJson(designType);
            });
        } else {
            // no image; clear bg and set zone
            this.fabricCanvas.setBackgroundImage(null, this.fabricCanvas.renderAll.bind(this.fabricCanvas));
            if (side.is_restricted_area) {
                this._setZone({ x: side.bound_x, y: side.bound_y, width: side.width, height: side.height });
            } else {
                this._setZone(null);
            }
            this._restoreSavedJson(designType);
        }
    },

    // Helper to set background image from URL (handles scaling center)
    _setBackgroundFromUrl: function (url, callback) {
        const self = this;
        fabric.Image.fromURL(url, (img) => {
            img.set({ selectable: false, evented: false });
            const w = this.fabricCanvas.getWidth();
            const h = this.fabricCanvas.getHeight();
            const scale = Math.min(w / img.width, h / img.height);
            img.left = (w - img.width * scale) / 2;
            img.top = (h - img.height * scale) / 2;
            img.scaleX = scale; img.scaleY = scale;
            this.fabricCanvas.setBackgroundImage(img, this.fabricCanvas.renderAll.bind(this.fabricCanvas));
        });
    },

    // Restore saved JSON for designType if exists, else clear objects but keep bg
    _restoreSavedJson: function (designType) {
        try {
            // Save current background image src (if any) so we can reapply it after load
            let bgSrc = null;
            let bgProps = null;
            const bg = this.fabricCanvas.backgroundImage;
            if (bg && bg._element && bg._element.src) {
                bgSrc = bg._element.src;
                bgProps = { left: bg.left, top: bg.top, scaleX: bg.scaleX, scaleY: bg.scaleY };
            }

            // Remove all user objects but keep zoneRect
            const objs = this.fabricCanvas.getObjects().slice(); // copy
            for (let o of objs) {
                if (this.zoneRect && o === this.zoneRect) {
                    continue;
                }
                this.fabricCanvas.remove(o);
            }

            // If we have stored JSON for this design type, load it
            if (this.designData[designType]) {
                // designData might be an object or stringified; normalize
                const jsonToLoad = (typeof this.designData[designType] === 'string') ?
                    JSON.parse(this.designData[designType]) : this.designData[designType];

                // load objects from JSON (this will recreate user objects)
                this.fabricCanvas.loadFromJSON(jsonToLoad, () => {
                    // ensure background is present (reapply using helper if we had src)
                    if (bgSrc) {
                        this._setBackgroundFromUrl(bgSrc, () => {
                            // zoneRect may have been removed/recreated by loadFromJSON - ensure our zoneRect exists and on top
                            if (this.zoneRect) this.zoneRect.bringToFront();
                            this.fabricCanvas.renderAll();
                        });
                    } else {
                        if (this.zoneRect) this.zoneRect.bringToFront();
                        this.fabricCanvas.renderAll();
                    }
                    // push initial state into history
                    this._saveState();
                });
            } else {
                // no saved JSON: keep only background + zoneRect
                if (bgSrc) {
                    this._setBackgroundFromUrl(bgSrc, () => {
                        if (this.zoneRect) this.zoneRect.bringToFront();
                        this.fabricCanvas.renderAll();
                    });
                } else {
                    if (this.zoneRect) this.zoneRect.bringToFront();
                    this.fabricCanvas.renderAll();
                }
                // save initial blank state
                this._saveState();
            }
        } catch (e) {
            console.error('Error restoring JSON for designType', designType, e);
        }
    },


    /**************************************************************************
     * Zone rectangle visual + clamp
     **************************************************************************/

    _setZone: function (zoneObj) {
        if (!zoneObj) {
            this.zone = null;
            if (this.zoneRect) {
                try { this.fabricCanvas.remove(this.zoneRect); } catch (e) { }
                this.zoneRect = null;
            }
            this.fabricCanvas.renderAll();
            return;
        }

        // Accept either x/y or bound_x/bound_y keys coming from backend
        const bx = parseFloat(zoneObj.x ?? zoneObj.bound_x) || 0;
        const by = parseFloat(zoneObj.y ?? zoneObj.bound_y) || 0;
        const bw = parseFloat(zoneObj.width ?? zoneObj.bound_width) || 0;
        const bh = parseFloat(zoneObj.height ?? zoneObj.bound_height) || 0;

        this.zone = { bound_x: bx, bound_y: by, width: bw, height: bh };

        // remove previous zoneRect
        if (this.zoneRect) {
            try { this.fabricCanvas.remove(this.zoneRect); } catch (e) { }
            this.zoneRect = null;
        }

        this.zoneRect = new fabric.Rect({
            left: this.zone.bound_x,
            top: this.zone.bound_y,
            width: this.zone.width,
            height: this.zone.height,
            fill: 'rgba(0,150,255,0.10)',    // subtle overlay
            stroke: '#0096FF',
            strokeDashArray: [6, 6],
            selectable: false,
            evented: false,
            hoverCursor: 'default',
        });

        // add and ensure it is on TOP of all objects (visible over background and user objects)
        this.fabricCanvas.add(this.zoneRect);
        this.zoneRect.bringToFront();

        // keep it above background if background exists
        this.fabricCanvas.renderAll();
    },

    _clampObjectToZone: function (obj) {
        if (!obj || !this.zone) return;

        obj.setCoords();
        const br = obj.getBoundingRect(true, true);
        let left = br.left, top = br.top, width = br.width, height = br.height;

        const minLeft = this.zone.bound_x;
        const minTop = this.zone.bound_y;
        const maxLeft = this.zone.bound_x + this.zone.width - width;
        const maxTop = this.zone.bound_y + this.zone.height - height;

        // If object is larger than zone, scale it down proportionally
        let resized = false;
        if (width > this.zone.width) {
            const scaleX = (this.zone.width - 10) / (obj.width || 1);
            obj.scaleX = Math.min(obj.scaleX || 1, scaleX);
            resized = true;
        }
        if (height > this.zone.height) {
            const scaleY = (this.zone.height - 10) / (obj.height || 1);
            obj.scaleY = Math.min(obj.scaleY || 1, scaleY);
            resized = true;
        }
        if (resized) {
            obj.setCoords();
        }

        // recompute bounding rect after possible resize
        const br2 = obj.getBoundingRect(true, true);
        left = br2.left; top = br2.top; width = br2.width; height = br2.height;

        let correctedLeft = left;
        let correctedTop = top;
        if (left < minLeft) correctedLeft = minLeft;
        if (top < minTop) correctedTop = minTop;
        if (left > maxLeft) correctedLeft = maxLeft;
        if (top > maxTop) correctedTop = maxTop;

        if (correctedLeft !== left || correctedTop !== top) {
            obj.left += (correctedLeft - left);
            obj.top += (correctedTop - top);
            obj.setCoords();
        }

        // Ensure zone rectangle remains on top
        if (this.zoneRect) this.zoneRect.bringToFront();
        this.fabricCanvas.renderAll();
    },


    /**************************************************************************
     * Add-to-cart: send all sides' JSON + previews to backend
     **************************************************************************/

    _generatePreviewDataURL: function () {
        try {
            return this.fabricCanvas.toDataURL({ format: 'png', quality: 0.8 });
        } catch (e) {
            console.error('Could not generate preview', e);
            return false;
        }
    },

    _onClickAddToCartPersonalized: function () {
        if (!this.fabricCanvas) return alert('Canvas not ready');
        this._saveCurrentSideState();

        // Build payload of designs
        const designs = {};
        for (const dt in this.designData) {
            if (Object.prototype.hasOwnProperty.call(this.designData, dt) && this.designData[dt]) {
                designs[dt] = {
                    json: JSON.stringify(this.designData[dt]),
                    preview: this._generatePreviewDataURL()
                };
            }
        }
        // If nothing saved, include active canvas
        if (Object.keys(designs).length === 0 && this.activeDesignType) {
            try {
                designs[this.activeDesignType] = {
                    json: JSON.stringify(this.fabricCanvas.toJSON()),
                    preview: this._generatePreviewDataURL()
                };
            } catch (e) { }
        }

        // Call existing endpoint
        rpc('/shop/cart/update_personalization', {
            product_id: this.productId,
            add_qty: 1,
            designs: designs
        }).then(() => {
            window.location.href = '/shop/cart';
        }).catch(error => {
            console.error('Add to cart error:', error);
            alert('Failed to add product to cart. Please try again.');
        });
    },

});
