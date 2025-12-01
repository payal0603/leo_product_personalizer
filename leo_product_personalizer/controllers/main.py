# -*- coding: utf-8 -*-
import json
import logging
from odoo import http
from odoo.http import request
from werkzeug.exceptions import NotFound

_logger = logging.getLogger(__name__)


class ProductPersonalizerController(http.Controller):

    @http.route(
        "/shop/personalize/<int:product_id>",
        type="http",
        auth="public",
        website=True,
    )
    def personalize_page(self, product_id, **kw):
        product = request.env["product.template"].sudo().browse(product_id)
        return request.render(
            "leo_product_personalizer.product_personalization_page",
            {"product": product},
        )

    # ---------------------------------------------------------------------------
    # Product metadata endpoint
    # ---------------------------------------------------------------------------
    @http.route(
        ["/shop/product_personalization_data"],
        type="jsonrpc",
        auth="public",
        methods=["POST"],
        csrf=False,
    )
    def product_personalization_data(self, product_id=None, variant_id=None, **kwargs):
        if not product_id:
            return {"error": "Missing product_id"}

        product_template = request.env["product.template"].sudo().browse(int(product_id))
        if not product_template:
            return {"error": "Product not found"}

        variants_data = self._get_variants_data(product_template)
        active_variant_id = (
            int(variant_id) if variant_id
            else variants_data[0]["id"] if variants_data else None
        )

        if not active_variant_id:
            return {"error": "No variants found"}

        designs, design_types = self._get_variant_designs(active_variant_id)
        fallback_image = self._get_image_url(None, active_variant_id)

        return {
            "product_id": product_template.id,
            "variants": variants_data,
            "active_variant_id": active_variant_id,
            "design_types": design_types,
            "default_design_type": design_types[0] if design_types else None,
            "designs": designs,
            "fallback_image_url": fallback_image,
        }

    def _get_variants_data(self, product_template):
        """Get list of variants with their images."""
        variants_data = []
        for variant in product_template.product_variant_ids:
            image_url = (
                f"/web/image/product.product/{variant.id}/image_1920"
                if variant.image_1920 else None
            )
            variants_data.append({
                "id": variant.id,
                "name": variant.display_name,
                "image_url": image_url,
            })
        return variants_data

    def _get_variant_designs(self, variant_id):
        """Get design configurations for a variant."""
        variant = request.env["product.product"].sudo().browse(variant_id)
        if not variant.exists():
            return {}, []

        designs = {}
        design_types = []

        for config in variant.design_config_ids:
            design_type = config.design_type or str(config.id)
            designs[design_type] = {
                "id": config.id,
                "design_type": config.design_type,
                "image_url": self._get_image_url(config, variant_id),
                "is_restricted_area": config.is_restricted_area,
                "bound_x": float(config.bound_x or 0.0),
                "bound_y": float(config.bound_y or 0.0),
                "bound_width": float(config.bound_width or 0.0),
                "bound_height": float(config.bound_height or 0.0),
            }
            design_types.append(design_type)
        return designs, design_types

    def _get_image_url(self, config, variant_id):
        """Get image URL for design config or fallback to variant image."""
        if config and config.design_image:
            return f"/web/image/product.design.config/{config.id}/design_image"

        variant = request.env["product.product"].sudo().browse(variant_id)
        if variant.exists() and variant.image_1920:
            return f"/web/image/product.product/{variant_id}/image_1920"
        return None

    def _parse_designs_payload(self, designs):
        """Parse designs payload, handle string or dict format."""
        if isinstance(designs, str):
            try:
                return json.loads(designs)
            except Exception:
                return {}
        return designs or {}

    def _save_personalization(self, line, variant, designs):
        """Save personalization records for a cart line."""
        created = []
        for config in variant.design_config_ids:
            d_type = config.design_type
            d_data = designs.get(d_type, {})

            personalized_json = d_data.get("json") if isinstance(d_data, dict) else None
            preview_dataurl = d_data.get("preview") if isinstance(d_data, dict) else None

            # Convert base64 preview or use config image
            preview_bin = False
            if preview_dataurl:
                if "data:" in str(preview_dataurl):
                    # Custom preview from canvas
                    try:
                        preview_bin = preview_dataurl.split(",", 1)[1]
                    except Exception:
                        pass
                
            # Fallback to config image if no custom preview
            if not preview_bin and config.design_image:
                preview_bin = config.design_image

            vals = {
                "sale_order_line_id": line.id,
                "design_type": d_type,
                "design_config_id": config.id,
                "personalized_json": personalized_json or json.dumps({"version": "5.3.0", "objects": []}),
                "product_image": preview_bin,
            }

            try:
                rec = request.env["sale.order.line.personalization"].sudo().create(vals)
                created.append(rec.id)
            except Exception as e:
                _logger.exception("Error saving personalization for %s: %s", d_type, e)

        return created

    @http.route(
        ["/shop/cart/update_personalization"],
        type="jsonrpc",
        auth="public",
        methods=["POST"],
        csrf=False,
        website=True,
    )
    def update_personalization(self, variant_id=None, designs=None, add_qty=1, **kwargs):
        """Add product with personalization to cart."""
        if not variant_id:
            return {"error": "Missing variant_id"}

        designs = self._parse_designs_payload(designs)
        if not isinstance(designs, dict):
            return {"error": "Invalid designs payload"}

        try:
            website = request.env["website"].sudo().get_current_website()
            order_sudo = request.cart or website._create_cart()

            values = order_sudo.with_context(skip_cart_verification=True)._cart_add(
                product_id=int(variant_id),
                quantity=float(add_qty),
            )

            line_id = values.get("line_id")
            if not line_id:
                return {"error": "Could not create cart line"}

            line = request.env["sale.order.line"].sudo().browse(int(line_id))
            variant = request.env["product.product"].sudo().browse(int(variant_id))
            created = self._save_personalization(line, variant, designs)

            return {
                "success": True,
                "line_id": line.id,
                "created_personalization_ids": created,
                "cart_quantity": order_sudo.cart_quantity,
            }
        except Exception as e:
            _logger.exception("Cart update error: %s", e)
            return {"error": str(e)}

    @http.route(
        ["/shop/cart/preview_personalization"],
        type="jsonrpc",
        auth="public",
        methods=["POST"],
        csrf=False,
    )
    def preview_personalization(self, line_id=None, **kwargs):
        """Get preview images for a cart line."""
        if not line_id:
            return {"error": "Missing line_id"}

        line = request.env["sale.order.line"].sudo().browse(int(line_id))
        if not line.exists():
            return {"error": "Cart line not found"}

        previews = []
        for personalization in line.personalization_ids:
            preview_data = {
                "design_type": personalization.design_type,
                "design_title": personalization.design_title or personalization.design_type,
            }

            if personalization.product_image:
                preview_data["preview_url"] = (
                    f"/web/image/sale.order.line.personalization/{personalization.id}/product_image"
                )
            else:
                preview_data["preview_url"] = None

            previews.append(preview_data)

        return {
            "success": True,
            "line_id": line.id,
            "product_name": line.product_id.display_name,
            "previews": previews,
        }

    @http.route(
        ["/shop/personalize/edit/<int:line_id>"],
        type="http",
        auth="public",
        website=True,
    )
    def personalize_edit(self, line_id, **kw):
        """Render personalization page in edit mode for existing cart line."""
        line = request.env["sale.order.line"].sudo().browse(int(line_id))
        if not line.exists():
            raise NotFound()

        return request.render(
            "leo_product_personalizer.product_personalization_page",
            {
                "product": line.product_id.product_tmpl_id,
                "edit_mode": True,
                "line_id": line.id,
                "variant_id": line.product_id.id,
            },
        )

    @http.route(
        ["/shop/cart/get_line_personalization"],
        type="jsonrpc",
        auth="public",
        methods=["POST"],
        csrf=False,
        website=True,
    )
    def get_line_personalization(self, line_id=None, **kwargs):
        """Get personalization data for editing an existing cart line."""
        if not line_id:
            return {"error": "Missing line_id", "success": False}

        line = request.env["sale.order.line"].sudo().browse(int(line_id))
        if not line.exists():
            return {"error": "Cart line not found", "success": False}

        designs = {}
        for personalization in line.personalization_ids:
            design_type = personalization.design_type
            try:
                personalized_json = personalization.personalized_json
                if isinstance(personalized_json, str):
                    try:
                        personalized_json = json.loads(personalized_json)
                    except json.JSONDecodeError as e:
                        _logger.error(f"Failed to parse personalized_json: {e}")
                
                if not isinstance(personalized_json, dict):
                    personalized_json = {"version": "5.3.0", "objects": []}
                
                if "objects" not in personalized_json:
                    personalized_json["objects"] = []


                designs[design_type] = {
                    "personalized_json": personalized_json,
                    "json": personalized_json,
                    "is_customized": len(personalized_json.get("objects", [])) > 0,
                }
                
                _logger.info(f"Loaded design type '{design_type}' with {len(personalized_json.get('objects', []))} objects")
                
            except Exception as e:
                _logger.exception("Error loading personalization for %s: %s", design_type, e)
                designs[design_type] = {
                    "personalized_json": {"version": "5.3.0", "objects": []},
                    "json": {"version": "5.3.0", "objects": []},
                    "is_customized": False,
                }

        return {
            "success": True,
            "line_id": line.id,
            "designs": designs,
        }    
    
    @http.route(
        ["/shop/cart/update_line_personalization"],
        type="jsonrpc",
        auth="public",
        methods=["POST"],
        csrf=False,
        website=True,
    )
    def update_line_personalization(self, line_id=None, designs=None, add_qty=1, **kwargs):
        """Update personalization records for an existing cart line."""
        if not line_id:
            return {"error": "Missing line_id", "success": False}

        designs = self._parse_designs_payload(designs)
        if not isinstance(designs, dict):
            return {"error": "Invalid designs payload", "success": False}

        try:
            line = request.env["sale.order.line"].sudo().browse(int(line_id))
            if not line.exists():
                return {"error": "Cart line not found", "success": False}
            
            # Update quantity
            line.sudo().write({"product_uom_qty": float(add_qty)})
            
            # Delete old personalization records
            _logger.info(f"Deleting {len(line.personalization_ids)} old personalization records for line {line_id}")
            line.personalization_ids.unlink()
            
            # Create new personalization records with updated data
            created = self._save_personalization(line, line.product_id, designs)

            return {
                "success": True,
                "line_id": line.id,
                "updated_personalization_ids": created,
            }
        except Exception as e:
            _logger.exception("Update line personalization error: %s", e)
            return {"error": str(e), "success": False}
