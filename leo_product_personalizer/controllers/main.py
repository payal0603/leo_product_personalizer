# -*- coding: utf-8 -*-
import json
import base64
import logging
from odoo import http
from odoo.http import request
from werkzeug.exceptions import NotFound

_logger = logging.getLogger(__name__)


class ProductPersonalizerController(http.Controller):
    """
    Controller to support product personalization flows:
      - /shop/product_personalization_data            -> returns design sides + metadata for a product
      - /shop/cart/update_personalization             -> creates/updates cart line and saves personalization records
      - /shop/personalize/save_side_to_session        -> optional: save intermediate side state in user session
      - /sale/personalization/image/<int:rec_id>      -> serve stored final/preview image (binary)
    """

    @http.route('/shop/personalize/<int:product_id>', type='http', auth='public', website=True)
    def personalize_page(self, product_id, **kw):
        product = request.env['product.template'].sudo().browse(product_id)
        return request.render('leo_product_personalizer.product_personalization_page', {
            'product': product
        })

    # -------------------------
    # Product metadata endpoint
    # -------------------------
    @http.route(['/shop/product_personalization_data'], type='json', auth='public', methods=['POST'], csrf=False)
    def product_personalization_data(self, product_id=None, **kwargs):
        """
        Returns a JSON object containing product personalization data.
        """
        if not product_id:
            return {'error': 'Missing product_id'}

        # try to read either product.template or product.product
        product_template = None
        try:
            # prefer product.template
            product_template = request.env['product.template'].sudo().browse(int(product_id))
            if not product_template.exists():
                # maybe it's a product.product id
                prod = request.env['product.product'].sudo().browse(int(product_id))
                if prod.exists():
                    product_template = prod.product_tmpl_id
        except Exception:
            return {'error': 'Invalid product_id'}

        if not product_template or not product_template.exists():
            return {'error': 'Product not found'}

        # fetch product.design.config records
        design_configs = request.env['product.design.config'].sudo().search([
            ('product_tmpl_id', '=', product_template.id),
        ])

        designs = {}
        design_types = []
        for cfg in design_configs:
            # image url (if binary present). Use design_image_name if available
            image_url = None
            if cfg.design_image:
                # fallback to a safe filename if not provided
                fname = (cfg.design_image_name or 'design_%s.png' % (cfg.id,))
                image_url = '/web/image/product.design.config/%s/design_image/%s' % (cfg.id, fname)

            key = (cfg.design_type or cfg.label or str(cfg.id)).strip()
            designs[key] = {
                'id': cfg.id,
                'design_type': key,
                'label': cfg.label or cfg.design_type,
                'image_url': image_url,
                'is_restricted_area': bool(cfg.is_restricted_area),
                'bound_x': float(cfg.bound_x or 0.0),
                'bound_y': float(cfg.bound_y or 0.0),
                'bound_width': float(cfg.bound_width or 0.0),
                'bound_height': float(cfg.bound_height or 0.0),
            }
            design_types.append(key)

        default = design_types[0] if design_types else False

        # fallback product image (product template's image_1920)
        fallback = None
        if product_template.image_1920:
            fallback = '/web/image/product.template/%s/image_1920' % product_template.id

        return {
            'product_id': int(product_template.id),
            'design_types': design_types,
            'default_design_type': default,
            'designs': designs,
            'fallback_image_url': fallback,
        }

    # -------------------------
    # Save a side state to session (optional)
    # -------------------------
    @http.route(['/shop/personalize/save_side_to_session'], type='json', auth='public', methods=['POST'], csrf=False)
    def save_side_to_session(self, product_id=None, design_type=None, canvas_json=None, preview_dataurl=None, **kwargs):
        """
        Save intermediate side design in user's session.
        Useful if frontend wants to persist work before clicking Add to Cart.
        Stores structure under request.session['product_personalizations'][product_id][design_type]
        """
        if not product_id or not design_type or not canvas_json:
            return {'error': 'Missing product_id or design_type or canvas_json'}

        sess = request.session.get('product_personalizations', {})
        pid = str(product_id)
        if pid not in sess:
            sess[pid] = {}
        sess[pid][design_type] = {
            'canvas_json': canvas_json,
            'preview': preview_dataurl,
        }
        request.session['product_personalizations'] = sess
        return {'status': 'ok'}

    # -------------------------
    # Add/update personalization in cart
    # -------------------------
    @http.route(['/shop/cart/update_personalization'], type='json', auth='public', methods=['POST'], csrf=False)
    def update_personalization(self, product_id=None, designs=None, add_qty=1, **kwargs):
        """
        Main endpoint to add personalized product to cart and save personalization data.

        Expected `designs` parameter can be:
          - a dict mapping design_type -> { 'json': <fabric json string>, 'preview': <dataURL> }
          - or a JSON string (stringified dict) — we will parse it.
        Behavior:
          - creates/updates cart line using website sale_get_order()._cart_update
          - after obtaining the line, creates sale.order.line.personalization records for each design side
        Returns:
          { 'success': True, 'line_id': <id> } on success
          { 'error': '...'} on failure
        """
        # defensive parsing if designs is stringified
        try:
            if isinstance(designs, str):
                try:
                    designs = json.loads(designs)
                except Exception:
                    # maybe designs was sent as single key in kwargs
                    # try to look for 'designs' in kwargs
                    designs = kwargs.get('designs') or {}
                    if isinstance(designs, str):
                        try:
                            designs = json.loads(designs)
                        except Exception:
                            designs = {}
        except Exception:
            designs = {}

        # fallback: some clients may post personalization_json
        if not designs and kwargs.get('personalization_json'):
            try:
                designs = json.loads(kwargs.get('personalization_json'))
            except Exception:
                designs = {}

        # If still no designs and there's session data, use it
        if not designs:
            sess = request.session.get('product_personalizations', {})
            pid = str(product_id)
            designs = sess.get(pid, {}) if pid in sess else {}

        # create or update order line via website flow
        try:
            website = request.env['website'].get_current_website()
            order = website.sale_get_order(force_create=True)

            order = request.website.sale_get_order(force_create=True)
            cart_res = order._cart_update(product_id=int(product_id), add_qty=int(add_qty))
            line_id = cart_res.get('line_id')
            if not line_id:
                return {'error': 'Could not create cart line'}
            line = request.env['sale.order.line'].sudo().browse(int(line_id))
        except Exception as e:
            _logger.exception("Error updating cart for personalized product: %s", e)
            return {'error': 'Cart update failed'}

        # designs expected as dict; iterate and create personalization records
        if not isinstance(designs, dict):
            return {'error': 'Invalid designs payload'}

        created = []
        for d_type, d_data in designs.items():
            try:
                # d_data may be { json: ..., preview: dataURL } or stringified versions
                fabric_json = d_data.get('json') if isinstance(d_data, dict) else None
                preview_dataurl = d_data.get('preview') if isinstance(d_data, dict) else None

                # if payload uses different keys, try some alternatives
                if not fabric_json:
                    fabric_json = d_data.get('fabric_json') if isinstance(d_data, dict) else None
                if not preview_dataurl:
                    preview_dataurl = d_data.get('preview_dataurl') if isinstance(d_data, dict) else None

                # find matching product.design.config by design_type on this product template
                design_config = None
                try:
                    design_config = request.env['product.design.config'].sudo().search([
                        ('product_tmpl_id', '=', request.env['product.template'].browse(int(product_id)).id),
                        ('design_type', '=', d_type)
                    ], limit=1)
                except Exception:
                    design_config = None

                preview_bin = False
                if preview_dataurl and isinstance(preview_dataurl, str) and preview_dataurl.startswith('data:'):
                    try:
                        header, b64 = preview_dataurl.split(',', 1)
                        preview_bin = base64.b64decode(b64)
                    except Exception:
                        preview_bin = False

                vals = {
                    'sale_order_line_id': line.id,
                    'design_type': d_type,
                    'fabric_json': fabric_json or (json.dumps(d_data) if isinstance(d_data, (dict, list)) else str(d_data)),
                    'preview': preview_bin,
                }
                if design_config:
                    vals['design_config_id'] = design_config.id

                rec = request.env['sale.order.line.personalization'].sudo().create(vals)
                created.append(rec.id)
            except Exception as e:
                _logger.exception("Failed to save personalization for side %s: %s", d_type, e)
                # continue saving other sides

        return {'success': True, 'line_id': line.id, 'created_personalization_ids': created}

    # -------------------------
    # Backwards-compatible route for older web_to_print style POSTs
    # -------------------------
    @http.route(['/custom/cart_update'], type='http', auth='public', methods=['POST'], csrf=False, website=True)
    def cart_update_legacy(self, product_id=None, **post):
        """
        Backwards compat for older web_to_print style posts where fields are named
        web_to_print_area_<area.id>_design and similar.
        This will construct a designs map and call the update_personalization handler.
        """
        try:
            product = request.env['product.product'].sudo().browse(int(product_id))
            product_template = product.product_tmpl_id
        except Exception:
            product_template = None

        # collect all product.design.config for template
        areas = []
        if product_template:
            areas = request.env['product.design.config'].sudo().search([('product_tmpl_id', '=', product_template.id)])

        designs = {}
        for area in areas:
            # older UI used fields like web_to_print_area_<id>_design etc.
            key_design = 'web_to_print_area_%s_design' % area.id
            key_text = 'web_to_print_area_%s_text' % area.id
            key_image = 'web_to_print_area_%s_image' % area.id
            key_image_name = 'web_to_print_area_%s_image_name' % area.id

            # check presence
            design_val = post.get(key_design)
            if not design_val:
                continue

            # design_val might be dataURL "data:image/png;base64,..."
            # old code used splitting by comma and taking [1]
            preview = None
            if isinstance(design_val, str) and design_val.startswith('data:'):
                preview = design_val
            # build fabric-like JSON or rehydrate fields as available
            fabric_json = json.dumps({
                'text': post.get(key_text) if post.get(key_text) and post.get(key_text) != 'False' else False,
                'image': post.get(key_image).split(',')[1] if post.get(key_image) and post.get(key_image) != 'False' else False,
                'image_name': post.get(key_image_name) if post.get(key_image_name) and post.get(key_image_name) != 'False' else False,
                'raw_design': design_val,
            })
            designs[area.design_type or area.label or str(area.id)] = {
                'json': fabric_json,
                'preview': preview,
            }

        # delegate to update_personalization
        return self.update_personalization(product_id=product_template.id if product_template else product_id, designs=designs, add_qty=1)

    # -------------------------
    # Serve stored image for personalization record
    # -------------------------
    @http.route(['/sale/personalization/image/<int:rec_id>'], type='http', auth='public', methods=['GET'], csrf=False)
    def serve_personalization_image(self, rec_id, **kwargs):
        """
        Serve the `preview` or `final_image` binary for a sale.order.line.personalization record.
        """
        rec = request.env['sale.order.line.personalization'].sudo().browse(rec_id)
        if not rec or not rec.exists():
            return request.not_found()

        # prefer final_image then preview
        img_bin = None
        if rec.final_image:
            img_bin = base64.b64decode(rec.final_image) if isinstance(rec.final_image, str) else rec.final_image
        elif rec.preview:
            img_bin = rec.preview if isinstance(rec.preview, (bytes, bytearray)) else (base64.b64decode(rec.preview) if isinstance(rec.preview, str) else None)

        if not img_bin:
            return request.not_found()

        headers = [('Content-Type', 'image/png'), ('Content-Length', len(img_bin))]
        return request.make_response(img_bin, headers=headers)
