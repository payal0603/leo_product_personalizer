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
        'change #text_font_family': '_onChangeTextProperty',
        'change #text_font_size': '_onChangeTextProperty',
        'change #text_color': '_onChangeTextProperty',
        'click #text_bold': '_onClickTextStyle',
        'click #text_italic': '_onClickTextStyle',
        'click #text_underline': '_onClickTextStyle',
        'change #shape_fill_color': '_onChangeShapeProperty',
        'change #shape_stroke_color': '_onChangeShapeProperty',
        'change #shape_stroke_width': '_onChangeShapeProperty',
        'click .preset-color': '_onClickPresetColor',
        'change #design_type_selector': '_onDesignTypeChange',
        'change #product_qty': '_onChangeQty',
        'change #variant_selector': '_onVariantChange',
        'click .menu-item': '_onMenuItemClick',
    },

    start: function () {
        const self = this;
        self.history = [];
        self.historyStep = -1;
        self.isUndoRedoAction = false;
        self.designData = {};
        self.activeDesignType = null;
        self.activeVariantId = null;
        self.zone = null;
        self.zoneRect = null;
        self.productData = null;
        self.fabricCanvas = null;
        self._layerCounter = 1;
        self.editMode = false;
        self.editLineId = null;
        self.editVariantId = null;

        return this._super.apply(this, arguments).then(function () {
            // Check if we're in edit mode
            self.editMode = self.$('#edit_mode').val() === 'true';
            self.editLineId = parseInt(self.$('#line_id').val()) || null;
            self.editVariantId = parseInt(self.$('#edit_variant_id').val()) || null;

            return self._loadProductData().then(function () {
                self._initializeCanvas();
                if (self.editMode && self.editLineId) {
                    return self._loadEditModeData();
                }
            }).then(function () {
                self._setupEventListeners();
                self._setupKeyboardShortcuts();
                self._initDesignTypeSelector();
            });
        });
    },



    _loadEditModeData: function () {
        const self = this;
        return rpc('/shop/cart/get_line_personalization', {
            line_id: self.editLineId
        }).then(function (result) {
            if (!result.success) {
                console.error('Failed to load line personalization:', result.error);
                return;
            }

            // Load the persisted design data from the cart line
            if (result.designs) {
                self.designData = result.designs;
                Object.keys(self.designData).forEach(function (designType) {
                    const design = self.designData[designType];
                    if (design.json && typeof design.json === 'string') {
                        design.json = JSON.parse(design.json);
                    }
                    if (design.product_image_url) {
                        design.backgroundImageUrl = design.product_image_url;
                    }
                });
            }
        }).catch(function (error) {
            console.error('Error loading edit mode data:', error);
        });
    },

    _initializeCanvas: function () {
        const wrapper = document.getElementById("canvas_wrapper");
        if (!wrapper) {
            console.error("canvas_wrapper not found");
            return;
        }

        wrapper.innerHTML = "";
        const canvas = document.createElement("canvas");
        canvas.id = "personalization_canvas";
        canvas.width = 800;
        canvas.height = 800;
        canvas.style.width = "800px";
        canvas.style.height = "800px";
        canvas.style.border = "2px solid #dee2e6";
        wrapper.appendChild(canvas);

        this.fabricCanvas = new fabric.Canvas("personalization_canvas");
    },

    _setupEventListeners: function () {
        const self = this;

        self.fabricCanvas.on('selection:created', function () {
            self._updateControls();
            self._renderLayersList();
        });

        self.fabricCanvas.on('selection:updated', function () {
            self._updateControls();
            self._renderLayersList();
        });

        self.fabricCanvas.on('selection:cleared', function () {
            self._hideControls();
            self._renderLayersList();
        });

        self.fabricCanvas.on('object:added', function (e) {
            if (e.target && e.target.isZoneRect !== true && e.target !== self.zoneRect) {
                if (!self.isUndoRedoAction) {
                    self._saveState();
                }
                self._onObjectAdded(e.target);
                // assign id and refresh layers list
                try {
                    self._assignLayerId(e.target);
                } catch (err) {
                    console.warn('assignLayerId failed', err);
                }
                self._renderLayersList();
            }
        });

        self.fabricCanvas.on('object:modified', function (e) {
            if (e.target && e.target.isZoneRect !== true && e.target !== self.zoneRect) {
                if (!self.isUndoRedoAction) {
                    self._saveState();
                }
                self._clampObjectToZone(e.target);
                self._renderLayersList();
            }
        });

        self.fabricCanvas.on('object:removed', function (e) {
            if (e.target && e.target.isZoneRect !== true && e.target !== self.zoneRect) {
                if (!self.isUndoRedoAction) {
                    self._saveState();
                }
                self._renderLayersList();
            }
        });

        self.fabricCanvas.on('object:moving', function (e) {
            if (e.target && e.target.isZoneRect !== true && e.target !== self.zoneRect) {
                self._clampObjectToZone(e.target);
            }
        });

        self.fabricCanvas.on('object:scaling', function (e) {
            if (e.target && e.target.isZoneRect !== true && e.target !== self.zoneRect) {
                self._clampObjectToZone(e.target);
            }
        });

        self.fabricCanvas.on('object:rotating', function (e) {
            if (e.target && e.target.isZoneRect !== true && e.target !== self.zoneRect) {
                self._clampObjectToZone(e.target);
            }
        });

        // Ensure zone stays on top after any render
        self.fabricCanvas.on('after:render', function () {
            if (self.zoneRect && !self.isUndoRedoAction) {
                const currentIndex = self.fabricCanvas.getObjects().indexOf(self.zoneRect);
                const lastIndex = self.fabricCanvas.getObjects().length - 1;
                if (currentIndex !== lastIndex) {
                    self.fabricCanvas.bringToFront(self.zoneRect);
                }
            }
        });
    },

    _onObjectAdded: function (obj) {
        const self = this;
        if (!obj || obj.isZoneRect === true || obj === self.zoneRect) return;

        // Skip auto-positioning during undo/redo or restoration
        if (self.isUndoRedoAction) {
            if (self.zoneRect) {
                self.fabricCanvas.bringToFront(self.zoneRect);
            }
            return;
        }

        // Wait for object to be fully added
        setTimeout(function () {
            if (self.zone && obj && !obj.isZoneRect) {
                const cx = self.zone.bound_x + (self.zone.width / 2);
                const cy = self.zone.bound_y + (self.zone.height / 2);

                obj.set({
                    left: cx,
                    top: cy,
                    originX: 'center',
                    originY: 'center'
                });
                obj.setCoords();

                // Scale down if larger than zone
                const br = obj.getBoundingRect(true, true);
                if (br.width > self.zone.width - 20 || br.height > self.zone.height - 20) {
                    const scaleX = (self.zone.width - 40) / obj.width;
                    const scaleY = (self.zone.height - 40) / obj.height;
                    const scale = Math.min(scaleX, scaleY);

                    obj.set({
                        scaleX: scale,
                        scaleY: scale
                    });
                    obj.setCoords();
                }
            }

            // Always ensure zone is on top
            if (self.zoneRect) {
                self.fabricCanvas.bringToFront(self.zoneRect);
            }
            self.fabricCanvas.renderAll();
        }, 10);
    },

    _setupKeyboardShortcuts: function () {
        const self = this;
        $(document).on('keydown', function (e) {
            if ($(e.target).is('input, textarea')) return;

            const obj = self.fabricCanvas.getActiveObject();
            if ((e.key === 'Delete' || e.key === 'Backspace') && obj && obj !== self.zoneRect) {
                e.preventDefault();
                self._deleteActiveObject();
            } else if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        self._onClickRedo();
                    } else {
                        self._onClickUndo();
                    }
                } else if (e.key === 'y') {
                    e.preventDefault();
                    self._onClickRedo();
                } 
            }
        });
    },

    _loadProductData: function () {
        const self = this;
        self.productId = parseInt(self.$('#product_id').val());
        
        // In edit mode, use the stored variant ID
        const variantIdParam = self.editMode && self.editVariantId ? self.editVariantId : null;

        return rpc('/shop/product_personalization_data', {
            product_id: self.productId,
            variant_id: variantIdParam
        }).then(function (data) {
            if (data.error) {
                alert(data.error);
                throw new Error(data.error);
            }
            self.productData = data;
            self.activeVariantId = data.active_variant_id;
            return data;
        }).catch(function (error) {
            console.error('Failed to load product data:', error);
            alert('Failed to load product data. Please refresh.');
            throw error;
        });
    },

    _onVariantChange: function (ev) {
        const self = this;
        
        if (self.editMode) {
            ev.preventDefault();
            alert('Cannot change variant while editing an existing design');
            return;
        }

        const newVariantId = parseInt(ev.target.value);
        if (!newVariantId || newVariantId === self.activeVariantId) return;

        // Save current variant's design before switching
        self._saveCurrentSideState();

        // Clear canvas and reset state
        self.fabricCanvas.clear();
        self.zoneRect = null;
        self.zone = null;

        // Switch variant
        self.activeVariantId = newVariantId;
        self.designData = {};

        return rpc('/shop/product_personalization_data', {
            product_id: self.productId,
            variant_id: newVariantId
        }).then(function (data) {
            if (data.error) {
                alert(data.error);
                return;
            }
            self.productData = data;

            // Re-initialize design type selector
            const $selector = self.$('#design_type_selector');
            const types = data.design_types || [];

            $selector.empty();
            types.forEach(function (t) {
                const label = t.replace(/_/g, ' ').replace(/\b\w/g, function (c) {
                    return c.toUpperCase();
                });
                $selector.append('<option value="' + t + '">' + label + '</option>');
            });

            const defaultType = data.default_design_type || types[0];
            self.activeDesignType = defaultType;
            $selector.val(defaultType);

            if (defaultType) {
                self._loadDesignType(defaultType);
            }
        }).catch(function (error) {
            console.error('Failed to load variant data:', error);
            alert('Failed to load variant. Please try again.');
        });
    },

    _onMenuItemClick: function (ev) {
        const $target = $(ev.currentTarget);
        const menuType = $target.data('menu');

        // Remove active from all
        this.$('.menu-item').removeClass('active');
        $target.addClass('active');

        // Hide all panels
        this.$('.menu-panel').hide();

        // Show selected panel
        this.$('#' + menuType + '_panel').show();
    },

    _saveState: function () {
        const self = this;
        try {
            self.history = self.history.slice(0, self.historyStep + 1);

            const canvasJSON = self.fabricCanvas.toJSON();

            // Filter out zone rectangles from history
            if (canvasJSON.objects) {
                canvasJSON.objects = canvasJSON.objects.filter(function (obj) {
                    return !obj.isZoneRect && obj.name !== 'zoneRect';
                });
            }

            self.history.push(JSON.stringify(canvasJSON));
            self.historyStep++;
            self._updateHistoryButtons();
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
        const self = this;
        self.isUndoRedoAction = true;
        const bg = self.fabricCanvas.backgroundImage;
        const currentZone = self.zone;

        self.fabricCanvas.loadFromJSON(self.history[self.historyStep], function () {
            if (bg) {
                self.fabricCanvas.setBackgroundImage(bg, self.fabricCanvas.renderAll.bind(self.fabricCanvas));
            }
            if (currentZone) {
                self._setZone(currentZone);
            }
            self.fabricCanvas.renderAll();
            self.isUndoRedoAction = false;
            self._updateHistoryButtons();
        });
    },

    _deleteActiveObject: function () {
        const obj = this.fabricCanvas.getActiveObject();
        if (obj && obj !== this.zoneRect) {
            this.fabricCanvas.remove(obj);
            this.fabricCanvas.renderAll();
        }
    },

    _updateControls: function () {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj || obj === this.zoneRect) {
            this._hideControls();
            return;
        }

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

    },

    _hideControls: function () {
        this.$('#text_controls, #shape_controls, #layer_controls').hide();
    },

    _toHex: function (color) {
        if (!color || color.startsWith('#')) return color || '#000000';
        const rgb = color.match(/\d+/g);
        if (!rgb || rgb.length < 3) return '#000000';
        return '#' + rgb.slice(0, 3).map(function (x) {
            return parseInt(x).toString(16).padStart(2, '0');
        }).join('');
    },

    _onClickAddText: function () {
        const self = this;
        if (!self.fabricCanvas) {
            alert('Canvas not ready');
            return;
        }

        const text = self.$('#personalization_text').val().trim();
        if (!text) {
            alert('Please enter some text');
            return;
        }

        const textObj = new fabric.IText(text, {
            left: 100,
            top: 100,
            fontFamily: 'Arial',
            fill: '#000000',
            fontSize: 40
        });

        self.fabricCanvas.add(textObj);
        // store a human-friendly label for layers list
        try { textObj.__label = text; } catch (e) { }
        self.fabricCanvas.setActiveObject(textObj);
        self.fabricCanvas.renderAll();
        self.$('#personalization_text').val('');
    },

    _onChangeTextProperty: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj || (obj.type !== 'i-text' && obj.type !== 'text')) return;

        const propMap = {
            'text_font_family': ['fontFamily', ev.target.value],
            'text_font_size': ['fontSize', parseInt(ev.target.value)],
            'text_color': ['fill', ev.target.value]
        };

        const prop = propMap[ev.target.id];
        if (prop) {
            obj.set(prop[0], prop[1]);
            this.fabricCanvas.renderAll();
        }
    },

    _onClickTextStyle: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj || (obj.type !== 'i-text' && obj.type !== 'text')) return;

        const styleMap = {
            'text_bold': ['fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold'],
            'text_italic': ['fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic'],
            'text_underline': ['underline', !obj.underline]
        };

        const style = styleMap[ev.target.id];
        if (style) {
            obj.set(style[0], style[1]);
            $(ev.currentTarget).toggleClass('active');
            this.fabricCanvas.renderAll();
        }
    },

    _onClickAddImage: function () {
        const self = this;
        if (!self.fabricCanvas) {
            alert('Canvas not ready');
            return;
        }

        const files = self.$('#personalization_image_upload')[0].files;
        if (!files || !files.length) {
            alert('Please select an image file');
            return;
        }

        Array.from(files).forEach(function (file, i) {
            const reader = new FileReader();
            reader.onload = function (e) {
                fabric.Image.fromURL(e.target.result, function (img) {
                    if (!img) return;
                    img.scaleToWidth(150);
                    img.set({
                        left: 100 + i * 20,
                        top: 100 + i * 20
                    });
                    // attach filename as label (used in layers list)
                    try {
                        if (img._element) img._element.name = file.name;
                    } catch (err) { }
                    try { img.__label = file.name; } catch (err) { }
                    self.fabricCanvas.add(img);
                    self.fabricCanvas.setActiveObject(img);
                    self.fabricCanvas.renderAll();
                });
            };
            reader.readAsDataURL(file);
        });

        self.$('#personalization_image_upload').val('');
    },

    _onClickAddShape: function () {
        const self = this;
        if (!self.fabricCanvas) {
            alert('Canvas not ready');
            return;
        }

        const props = {
            left: 100,
            top: 100,
            fill: '#3b82f6',
            stroke: '#1e40af',
            strokeWidth: 2
        };

        const $shapeSelect = self.$('#personalization_shape');
        const shapeType = $shapeSelect.val();
        const shapeLabel = $shapeSelect.find('option:selected').text() || shapeType;
        let shape = null;

        switch (shapeType) {
            case 'rect':
            case 'square':
                shape = new fabric.Rect({ ...props, width: 100, height: 100 });
                break;
            case 'circle':
                shape = new fabric.Circle({ ...props, radius: 50 });
                break;
            case 'ellipse':
                shape = new fabric.Ellipse({ ...props, rx: 60, ry: 40 });
                break;
            case 'triangle':
                shape = new fabric.Triangle({ ...props, width: 100, height: 100 });
                break;
            case 'line':
                shape = new fabric.Line([50, 50, 200, 50], { ...props, fill: null, strokeWidth: 4 });
                break;
            case 'polygon':
                shape = new fabric.Polygon([
                    { x: 50, y: 0 },
                    { x: 100, y: 38 },
                    { x: 82, y: 100 },
                    { x: 18, y: 100 },
                    { x: 0, y: 38 }
                ], props);
                break;
            case 'star':
                const pts = [];
                for (let i = 0; i < 10; i++) {
                    const r = i % 2 ? 25 : 50;
                    const a = (i * Math.PI) / 5;
                    pts.push({
                        x: 50 + r * Math.sin(a),
                        y: 50 - r * Math.cos(a)
                    });
                }
                shape = new fabric.Polygon(pts, props);
                break;
            case 'heart':
                shape = new fabric.Path('M 50,30 C 50,20 40,10 30,10 C 20,10 10,20 10,30 C 10,50 30,70 50,90 C 70,70 90,50 90,30 C 90,20 80,10 70,10 C 60,10 50,20 50,30 Z', { ...props, scaleX: 0.8, scaleY: 0.8 });
                break;
            case 'arrow':
                shape = new fabric.Path('M 10,50 L 60,50 L 60,30 L 90,55 L 60,80 L 60,60 L 10,60 Z', props);
                break;
            case 'hexagon':
                const hexPts = [];
                for (let i = 0; i < 6; i++) {
                    hexPts.push({
                        x: 50 + 50 * Math.cos(Math.PI / 3 * i),
                        y: 50 + 50 * Math.sin(Math.PI / 3 * i)
                    });
                }
                shape = new fabric.Polygon(hexPts, props);
                break;
            case 'diamond':
                shape = new fabric.Polygon([
                    { x: 50, y: 0 },
                    { x: 100, y: 50 },
                    { x: 50, y: 100 },
                    { x: 0, y: 50 }
                ], props);
                break;
        }

        if (shape) {
            // attach a readable label for the layers list (from dropdown)
            try { shape.__label = shapeLabel; } catch (e) { }
            self.fabricCanvas.add(shape);
            self.fabricCanvas.setActiveObject(shape);
            self.fabricCanvas.renderAll();
        }
    },

    _onChangeShapeProperty: function (ev) {
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj || obj.type === 'i-text' || obj.type === 'text' || obj.type === 'image') return;

        const propMap = {
            'shape_fill_color': ['fill', ev.target.value],
            'shape_stroke_color': ['stroke', ev.target.value],
            'shape_stroke_width': ['strokeWidth', parseInt(ev.target.value)]
        };

        const prop = propMap[ev.target.id];
        if (prop) {
            obj.set(prop[0], prop[1]);
            this.fabricCanvas.renderAll();
        }
    },

    _onClickPresetColor: function (ev) {
        const color = $(ev.currentTarget).data('color');
        const obj = this.fabricCanvas.getActiveObject();
        if (!obj || obj === this.zoneRect) return;

        if (obj.type === 'i-text' || obj.type === 'text') {
            obj.set('fill', color);
            this.$('#text_color').val(color);
        } else if (obj.type !== 'image') {
            obj.set('fill', color);
            this.$('#shape_fill_color').val(color);
        }

        this.fabricCanvas.renderAll();
    },

    _initDesignTypeSelector: function () {
        const self = this;

        if (self.productData.variants && self.productData.variants.length > 0) {
            const $variantSelector = self.$('#variant_selector');
            $variantSelector.empty();

            self.productData.variants.forEach(function (v) {
                $variantSelector.append('<option value="' + v.id + '">' + v.name + '</option>');
            });

            // In edit mode, set the current variant
            if (self.editMode && self.editVariantId) {
                $variantSelector.val(self.editVariantId);
            } else {
                $variantSelector.val(self.activeVariantId);
            }

            // Disable variant menu in edit mode
            if (self.editMode) {
                self.$('.menu-item[data-menu="variant"]').css({
                    'opacity': '0.5',
                    'pointer-events': 'none',
                    'cursor': 'not-allowed'
                });
            }
        }

        // Initialize design type selector
        const $selector = self.$('#design_type_selector');
        const types = self.productData.design_types || [];

        $selector.empty();
        types.forEach(function (t) {
            const label = t.replace(/_/g, ' ').replace(/\b\w/g, function (c) {
                return c.toUpperCase();
            });
            $selector.append('<option value="' + t + '">' + label + '</option>');
        });

        const defaultType = self.productData.default_design_type || types[0];
        self.activeDesignType = defaultType;
        $selector.val(defaultType);

        self._loadDesignType(defaultType);
    },

    _onDesignTypeChange: function (ev) {
        const newType = ev.target.value;
        if (!newType || newType === this.activeDesignType) return;

        this._saveCurrentSideState();
        this.activeDesignType = newType;
        this._loadDesignType(newType);
    },

    _saveCurrentSideState: function () {
        const self = this;
        try {
            if (!self.activeDesignType) return;

            const canvasJSON = self.fabricCanvas.toJSON();

            // Filter out zone rectangles
            if (canvasJSON.objects) {
                canvasJSON.objects = canvasJSON.objects.filter(function (obj) {
                    return !obj.isZoneRect && obj.name !== 'zoneRect';
                });
            }

            // Save ONLY for current design type
            self.designData[self.activeDesignType] = canvasJSON;

        } catch (e) {
            console.error('Could not save current canvas JSON', e);
        }
    },

    _loadDesignType: function (designType) {
        const self = this;

        // Clear canvas completely first
        self.fabricCanvas.clear();
        self.zoneRect = null;
        self.zone = null;

        const designs = (self.productData && self.productData.designs) ? self.productData.designs : {};
        const side = designs[designType];
        const savedDesignData = self.designData[designType];

        if (!side && !savedDesignData) {
            if (self.productData && self.productData.fallback_image_url) {
                self._setBackgroundFromUrl(self.productData.fallback_image_url, function () {
                    self._restoreSavedJson(designType);
                });
            } else {
                self.fabricCanvas.setBackgroundImage(null, self.fabricCanvas.renderAll.bind(self.fabricCanvas));
                self._restoreSavedJson(designType);
            }
            return;
        }

        // In edit mode, prefer the saved background image URL over the design config image
        let backgroundUrl = null;
        if (self.editMode && savedDesignData && savedDesignData.backgroundImageUrl) {
            backgroundUrl = savedDesignData.backgroundImageUrl;
        } else if (side && side.image_url) {
            backgroundUrl = side.image_url;
        } else if (self.productData && self.productData.fallback_image_url) {
            backgroundUrl = self.productData.fallback_image_url;
        }
        debugger;
        if (backgroundUrl) {
            self._setBackgroundFromUrl(backgroundUrl, function () {
                if (side && side.is_restricted_area) {
                    const zoneData = {
                        bound_x: parseFloat(side.bound_x) || 0,
                        bound_y: parseFloat(side.bound_y) || 0,
                        width: parseFloat(side.bound_width || side.width) || 0,
                        height: parseFloat(side.bound_height || side.height) || 0
                    };
                    self._setZone(zoneData);
                    self._restoreSavedJson(designType);
                } else {
                    self._restoreSavedJson(designType);
                }
            });
        } else {
            self.fabricCanvas.setBackgroundImage(null, self.fabricCanvas.renderAll.bind(self.fabricCanvas));
            if (side && side.is_restricted_area) {
                const zoneData = {
                    bound_x: parseFloat(side.bound_x) || 0,
                    bound_y: parseFloat(side.bound_y) || 0,
                    width: parseFloat(side.bound_width || side.width) || 0,
                    height: parseFloat(side.bound_height || side.height) || 0
                };
                self._setZone(zoneData);
                self._restoreSavedJson(designType);
            } else {
                self._restoreSavedJson(designType);
            }
        }
    },

    _setBackgroundFromUrl: function (url, callback) {
        const self = this;
        
        fabric.Image.fromURL(url, function (img) {
            if (!img) {
                console.warn('Failed to load image from URL:', url, '- retrying with absolute path');
                
                // If URL is relative, try with absolute path
                if (url && url.startsWith('/')) {
                    const absoluteUrl = window.location.origin + url;
                    fabric.Image.fromURL(absoluteUrl, function (img2) {
                        if (img2) {
                            self._applyBackgroundImage(img2);
                        } else {
                            console.error('Failed to load image from both relative and absolute URLs:', url, absoluteUrl);
                        }
                        if (callback) callback();
                    }, null, {
                        crossOrigin: 'anonymous'
                    });
                } else {
                    console.error('Failed to load image from URL:', url);
                    if (callback) callback();
                }
                return;
            }

            self._applyBackgroundImage(img);
            if (callback) callback();
        }, null, {
            crossOrigin: 'anonymous'
        });
    },

    _applyBackgroundImage: function (img) {
        const self = this;
        
        img.set({
            selectable: false,
            evented: false
        });

        const w = self.fabricCanvas.getWidth();
        const h = self.fabricCanvas.getHeight();
        const scale = Math.min(w / img.width, h / img.height);

        img.left = (w - img.width * scale) / 2;
        img.top = (h - img.height * scale) / 2;
        img.scaleX = scale;
        img.scaleY = scale;

        self.fabricCanvas.setBackgroundImage(img, self.fabricCanvas.renderAll.bind(self.fabricCanvas));
    },

    _restoreSavedJson: function (designType) {
        const self = this;

        self.isUndoRedoAction = true;

        try {
            // Remove all user objects (keep background and zone)
            const objs = self.fabricCanvas.getObjects().slice();
            for (let i = 0; i < objs.length; i++) {
                const o = objs[i];
                if (o.isZoneRect === true || o.name === 'zoneRect') continue;
                self.fabricCanvas.remove(o);
            }

            // Load ONLY the saved data for THIS specific design type
            const savedForThisType = self.designData[designType];

            if (savedForThisType) {
                let jsonToLoad = savedForThisType;

                if (typeof jsonToLoad === 'string') {
                    jsonToLoad = JSON.parse(jsonToLoad);
                }

                // Ensure no zone rectangles in saved data
                if (jsonToLoad.objects) {
                    jsonToLoad.objects = jsonToLoad.objects.filter(function (obj) {
                        return obj.isZoneRect !== true && obj.name !== 'zoneRect';
                    });
                }

                self.fabricCanvas.loadFromJSON(jsonToLoad, function () {
                    // Ensure zone stays on top after loading
                    if (self.zoneRect) {
                        self.fabricCanvas.bringToFront(self.zoneRect);
                    }
                    self.fabricCanvas.renderAll();
                    // assign stable layer ids and update layers UI
                    try { self._assignLayerIds(); } catch (e) { }
                    try { self._renderLayersList(); } catch (e) { }
                    self.isUndoRedoAction = false;

                    // Initialize history for this design type
                    setTimeout(function () {
                        self.history = [];
                        self.historyStep = -1;
                        self._saveState();
                    }, 100);
                });
            } else {
                // No saved data for this design type - start fresh
                if (self.zoneRect) {
                    self.fabricCanvas.bringToFront(self.zoneRect);
                }
                self.fabricCanvas.renderAll();
                try { self._assignLayerIds(); } catch (e) { }
                try { self._renderLayersList(); } catch (e) { }
                self.isUndoRedoAction = false;

                // Initialize history
                setTimeout(function () {
                    self.history = [];
                    self.historyStep = -1;
                    self._saveState();
                }, 100);
            }
        } catch (e) {
            console.error('Error restoring JSON for designType', designType, e);
            self.isUndoRedoAction = false;
        }
    },

    _setZone: function (zoneObj) {
        const self = this;

        // Force remove all existing zone rectangles
        const allObjs = self.fabricCanvas.getObjects();
        for (let i = allObjs.length - 1; i >= 0; i--) {
            if (allObjs[i].isZoneRect === true || allObjs[i].name === 'zoneRect') {
                self.fabricCanvas.remove(allObjs[i]);
            }
        }

        self.zoneRect = null;
        self.zone = null;

        if (!zoneObj) {
            self.fabricCanvas.renderAll();
            return;
        }

        const bx = parseFloat(zoneObj.bound_x) || 0;
        const by = parseFloat(zoneObj.bound_y) || 0;
        const bw = parseFloat(zoneObj.width) || 0;
        const bh = parseFloat(zoneObj.height) || 0;

        if (bw <= 0 || bh <= 0) {
            console.warn('Invalid zone dimensions');
            return;
        }

        self.zone = {
            bound_x: bx,
            bound_y: by,
            width: bw,
            height: bh
        };

        self.zoneRect = new fabric.Rect({
            left: bx,
            top: by,
            width: bw,
            height: bh,
            fill: 'rgba(0, 150, 255, 0.15)',
            stroke: '#0096FF',
            strokeWidth: 3,
            strokeDashArray: [10, 5],
            selectable: false,
            evented: false,
            hoverCursor: 'default',
            hasControls: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            isZoneRect: true,
            name: 'zoneRect',
            excludeFromExport: true
        });

        self.fabricCanvas.add(self.zoneRect);
        self.fabricCanvas.bringToFront(self.zoneRect);
        self.fabricCanvas.renderAll();
    },

    _ensureZoneOnTop: function () {
        const self = this;
        // Remove any duplicate zones
        const allObjs = self.fabricCanvas.getObjects();
        const zones = [];

        for (let i = 0; i < allObjs.length; i++) {
            if (allObjs[i].isZoneRect === true || allObjs[i].name === 'zoneRect') {
                zones.push(allObjs[i]);
            }
        }

        // Keep only the current zoneRect, remove others
        for (let i = 0; i < zones.length; i++) {
            if (zones[i] !== self.zoneRect) {
                self.fabricCanvas.remove(zones[i]);
            }
        }

        // Bring current zone to front
        if (self.zoneRect) {
            self.fabricCanvas.bringToFront(self.zoneRect);
        }
    },

    _clampObjectToZone: function (obj) {
        const self = this;
        if (!obj || !self.zone || obj === self.zoneRect) return;

        obj.setCoords();
        const br = obj.getBoundingRect(true, true);

        const minLeft = self.zone.bound_x;
        const minTop = self.zone.bound_y;
        const maxRight = self.zone.bound_x + self.zone.width;
        const maxBottom = self.zone.bound_y + self.zone.height;

        let needsAdjustment = false;

        if (br.width > self.zone.width) {
            const scale = (self.zone.width - 10) / obj.width;
            obj.scaleX = Math.min(obj.scaleX, scale);
            obj.scaleY = Math.min(obj.scaleY, scale);
            needsAdjustment = true;
        }

        if (br.height > self.zone.height) {
            const scale = (self.zone.height - 10) / obj.height;
            obj.scaleX = Math.min(obj.scaleX, scale);
            obj.scaleY = Math.min(obj.scaleY, scale);
            needsAdjustment = true;
        }

        if (needsAdjustment) {
            obj.setCoords();
        }

        const br2 = obj.getBoundingRect(true, true);
        let correctedLeft = obj.left;
        let correctedTop = obj.top;

        if (br2.left < minLeft) {
            correctedLeft = obj.left + (minLeft - br2.left);
        }
        if (br2.top < minTop) {
            correctedTop = obj.top + (minTop - br2.top);
        }
        if (br2.left + br2.width > maxRight) {
            correctedLeft = obj.left - ((br2.left + br2.width) - maxRight);
        }
        if (br2.top + br2.height > maxBottom) {
            correctedTop = obj.top - ((br2.top + br2.height) - maxBottom);
        }

        if (correctedLeft !== obj.left || correctedTop !== obj.top) {
            obj.set({
                left: correctedLeft,
                top: correctedTop
            });
            obj.setCoords();
        }

        self._ensureZoneOnTop();
        self.fabricCanvas.renderAll();
    },

    _onChangeQty: function (ev) {
        const qty = parseInt(ev.target.value) || 1;
        this.$('#product_qty').val(Math.max(1, qty));
    },

    _onClickAddToCartPersonalized: async function () {
        const self = this;

        if (!self.fabricCanvas || !self.activeVariantId) {
            alert('Canvas not ready or no variant selected');
            return;
        }

        // Save current active design type state
        self._saveCurrentSideState();

        const designs = {};
        const allDesignTypes = self.productData.design_types || [];

        // Process each design type separately
        for (const dt of allDesignTypes) {
            let canvasJSON, previewURL;

            if (self.designData[dt] && self.designData[dt].objects && self.designData[dt].objects.length > 0) {
                // User customized this design type
                canvasJSON = self.designData[dt];
                previewURL = await self._generatePreviewForDesignType(dt);
            } else {
                // Use original design config image
                const designConfig = self.productData.designs[dt];
                previewURL = designConfig ? designConfig.image_url : self.productData.fallback_image_url;
                canvasJSON = { version: "5.3.0", objects: [] };
            }

            const filteredJSON = {
                ...canvasJSON,
                objects: (canvasJSON.objects || []).filter(obj => !obj.isZoneRect && obj.name !== 'zoneRect')
            };

            designs[dt] = {
                json: JSON.stringify(filteredJSON),
                preview: previewURL,
            };
        }

        const qty = self.editMode ? 1 : (parseInt(self.$('#product_qty').val()) || 1);

        if (self.editMode && self.editLineId) {
            rpc('/shop/cart/update_line_personalization', {
                line_id: self.editLineId,
                designs: designs
            }).then(function (result) {
                if (result && result.success) {
                    window.location.href = '/shop/cart';
                } else {
                    alert(result.error || 'Failed to update design');
                }
            }).catch(function (error) {
                console.error('Update design error:', error);
                alert('Failed to update design');
            });
        } else {
            rpc('/shop/cart/update_personalization', {
                variant_id: self.activeVariantId,
                add_qty: qty,
                designs: designs
            }).then(function (result) {
                if (result && result.success) {
                    window.location.href = '/shop/cart';
                } else {
                    alert(result.error || 'Failed to add product to cart');
                }
            }).catch(function (error) {
                console.error('Add to cart error:', error);
                alert('Failed to add product to cart');
            });
        }
    },

    _generatePreviewForDesignType: function (designType) {
        const self = this;

        // Get saved data for this specific design type
        const savedData = self.designData[designType];

        if (!savedData || !savedData.objects || savedData.objects.length === 0) {
            // Return design config image URL
            const designConfig = self.productData.designs[designType];
            return designConfig ? designConfig.image_url : self.productData.fallback_image_url;
        }

        try {
            // Create temporary canvas for preview generation
            const tempCanvas = new fabric.Canvas(document.createElement('canvas'));
            tempCanvas.setWidth(800);
            tempCanvas.setHeight(800);

            // Load design config background for this type
            const designConfig = self.productData.designs[designType];
            const bgUrl = designConfig ? designConfig.image_url : self.productData.fallback_image_url;

            return new Promise(function (resolve) {
                if (bgUrl) {
                    fabric.Image.fromURL(bgUrl, function (img) {
                        if (img) {
                            const w = tempCanvas.getWidth();
                            const h = tempCanvas.getHeight();
                            const scale = Math.min(w / img.width, h / img.height);

                            img.set({
                                left: (w - img.width * scale) / 2,
                                top: (h - img.height * scale) / 2,
                                scaleX: scale,
                                scaleY: scale,
                                selectable: false,
                                evented: false
                            });

                            tempCanvas.setBackgroundImage(img, function () {
                                loadObjects();
                            });
                        } else {
                            loadObjects();
                        }
                    }, null, {
                        crossOrigin: 'anonymous'
                    });
                } else {
                    loadObjects();
                }

                function loadObjects() {
                    tempCanvas.loadFromJSON(savedData, function () {
                        const dataURL = tempCanvas.toDataURL({ format: 'png', quality: 0.8 });
                        tempCanvas.dispose();
                        resolve(dataURL);
                    });
                }
            });

        } catch (e) {
            console.error('Preview generation failed:', e);
            const designConfig = self.productData.designs[designType];
            return designConfig ? designConfig.image_url : self.productData.fallback_image_url;
        }
    },

    /* Layer list helpers */
    _assignLayerId: function (obj) {
        const self = this;
        if (!obj) return;
        if (!obj.__layerId) {
            obj.__layerId = 'layer_' + (self._layerCounter++);
        }
        return obj.__layerId;
    },

    _assignLayerIds: function () {
        const self = this;
        const objs = self.fabricCanvas ? self.fabricCanvas.getObjects() : [];
        objs.forEach(function (o) {
            if (o && !o.isZoneRect && o.name !== 'zoneRect') {
                self._assignLayerId(o);
            }
        });
    },

    _renderLayersList: function () {
        const self = this;
        const $list = self.$('#layers_list');
        if (!$list || !$list.length) return;

        // Ensure ids assigned
        self._assignLayerIds();

        // Build items: top-most object first
        const objs = (self.fabricCanvas ? self.fabricCanvas.getObjects() : []).filter(function (o) {
            return o && !o.isZoneRect && o.name !== 'zoneRect';
        });

        // Reverse to show top-first
        const items = objs.slice().reverse();

        $list.empty();

        items.forEach(function (obj) {
            const layerId = obj.__layerId;
            const $item = $('<div class="layer-item d-flex align-items-center p-2" ' +
                'data-layer-id="' + layerId + '" style="border-bottom:1px solid #eee; cursor:pointer;"></div>');

            // Thumbnail
            const $thumb = $('<div style="width:46px; height:46px; flex:0 0 46px; border:1px solid #ddd; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fff; margin-right:8px;"></div>');
            if (obj.type === 'image' && obj._element && obj._element.src) {
                const $img = $('<img/>').attr('src', obj._element.src).css({ width: '100%', height: '100%', objectFit: 'cover' });
                $thumb.append($img);
            } else if (obj.type === 'i-text' || obj.type === 'text') {
                const text = (obj.text || '').toString();
                $thumb.append($('<div style="font-size:11px; padding:4px; text-align:center;">' + (text.length > 20 ? text.substr(0, 20) + '…' : text) + '</div>'));
            } else {
                // Shape: use shape icon (stored __label or type to pick icon)
                const shapeType = obj.__label ? obj.__label.toLowerCase() : (obj.type || 'shape').toLowerCase();
                let icon = 'fa-layer-group';
                if (shapeType.indexOf('rect') >= 0) icon = 'fa-square';
                else if (shapeType.indexOf('circle') >= 0 || shapeType.indexOf('ellipse') >= 0) icon = 'fa-circle';
                else if (shapeType.indexOf('triangle') >= 0) icon = 'fa-play';
                else if (shapeType.indexOf('star') >= 0) icon = 'fa-star';
                else if (shapeType.indexOf('heart') >= 0) icon = 'fa-heart';
                else if (shapeType.indexOf('diamond') >= 0) icon = 'fa-diamond';
                else if (shapeType.indexOf('arrow') >= 0) icon = 'fa-arrow-right';
                else if (shapeType.indexOf('pentagon') >= 0 || shapeType.indexOf('hexagon') >= 0) icon = 'fa-stop';
                else if (shapeType.indexOf('line') >= 0) icon = 'fa-minus';
                $thumb.append($('<i class="fa ' + icon + '" style="font-size:20px; color:#3b82f6;"></i>'));
            }

            // Label
            let label = '';
            if (obj.type === 'i-text' || obj.type === 'text') {
                label = obj.text || 'Text';
            } else if (obj.type === 'image') {
                label = (obj._element && obj._element.name) ? obj._element.name : 'Image';
            } else {
                // For shapes, use stored __label if available, else use type
                label = obj.__label || obj.type || 'Shape';
            }

            const $label = $('<div style="flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;"></div>').text(label);

            // Controls (hidden by default, shown on hover)
            const $controls = $('<div class="layer-controls btn-group" style="display:none; flex:0 0 auto; margin-left:8px; gap:2px;"></div>');
            const $btnFront = $('<button class="btn btn-sm btn-outline-secondary" title="Bring to Front"><i class="fa fa-arrow-up"/></button>');
            const $btnBack = $('<button class="btn btn-sm btn-outline-secondary" title="Send to Back"><i class="fa fa-arrow-down"/></button>');
            const $btnDup = $('<button class="btn btn-sm btn-outline-secondary" title="Duplicate"><i class="fa fa-copy"/></button>');
            const $btnLock = $('<button class="btn btn-sm btn-outline-secondary" title="Lock/Unlock"><i class="fa fa-lock"/></button>');
            const $btnDel = $('<button class="btn btn-sm btn-outline-danger" title="Delete"><i class="fa fa-trash"/></button>');

            $controls.append($btnFront, $btnBack, $btnDup, $btnLock, $btnDel);

            $item.append($thumb, $label, $controls);

            // hover show controls
            $item.on('mouseenter', function () {
                $controls.show();
            }).on('mouseleave', function () {
                $controls.hide();
            });

            // click selects object
            $item.on('click', function (ev) {
                ev.stopPropagation();
                self.fabricCanvas.discardActiveObject();
                self.fabricCanvas.setActiveObject(obj);
                self.fabricCanvas.renderAll();
                self._updateControls();
                self._renderLayersList();
            });

            // control actions
            $btnFront.on('click', function (ev) {
                ev.stopPropagation();
                self.fabricCanvas.bringToFront(obj);
                self._ensureZoneOnTop();
                self.fabricCanvas.renderAll();
                self._renderLayersList();
            });
            $btnBack.on('click', function (ev) {
                ev.stopPropagation();
                self.fabricCanvas.sendToBack(obj);
                self._ensureZoneOnTop();
                self.fabricCanvas.renderAll();
                self._renderLayersList();
            });
            $btnDup.on('click', function (ev) {
                ev.stopPropagation();
                obj.clone(function (cloned) {
                    cloned.set({ left: cloned.left + 20, top: cloned.top + 20 });
                    self.fabricCanvas.add(cloned);
                    self.fabricCanvas.setActiveObject(cloned);
                    self.fabricCanvas.renderAll();
                });
            });
            $btnLock.on('click', function (ev) {
                ev.stopPropagation();
                const locked = !obj.lockMovementX;
                obj.set({ lockMovementX: locked, lockMovementY: locked, lockRotation: locked, lockScalingX: locked, lockScalingY: locked });
                self.fabricCanvas.renderAll();
                self._renderLayersList();
            });
            $btnDel.on('click', function (ev) {
                ev.stopPropagation();
                self.fabricCanvas.remove(obj);
                self.fabricCanvas.renderAll();
                self._renderLayersList();
            });

            // mark selected
            if (self.fabricCanvas.getActiveObject() === obj) {
                $item.css('background', '#f1f5f9');
            }

            $list.append($item);
        });
    },
});