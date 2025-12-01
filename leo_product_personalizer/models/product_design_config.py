from odoo import fields, models


class ProductDesignConfig(models.Model):
    # ------------------------------------------------------------------
    # 1. PRIVATE ATTRIBUTES
    # ------------------------------------------------------------------

    _name = "product.design.config"
    _description = "Product Design Config (sides/areas for personalization)"

    # ------------------------------------------------------------------
    # 2. DEFAULT METHODS AND default_get
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 3. FIELD DECLARATIONS
    # ------------------------------------------------------------------

    product_variant_id = fields.Many2one(
        "product.product",
        string="Product Variant",
        help="Leave empty to apply to all variants",
        required=True,
        ondelete="cascade",
    )
    product_tmpl_id = fields.Many2one(
        "product.template",
        related="product_variant_id.product_tmpl_id",
        store=True,
        readonly=True,
    )

    design_type = fields.Char(
        string="Design Type",
        required=True,
        help="Identifier for the design side (e.g. front, back)",
    )
    design_image = fields.Image("Image")

    is_restricted_area = fields.Boolean(
        "Has Restricted Area",
        help="When checked, user edits will be clamped inside the rectangle below.",
    )
    bound_x = fields.Float("Bound X (px)")
    bound_y = fields.Float("Bound Y (px)")
    bound_width = fields.Float("Bound Width (px)")
    bound_height = fields.Float("Bound Height (px)")

    # ------------------------------------------------------------------
    # 4. COMPUTE, INVERSE AND SEARCH METHODS
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 5. SELECTION METHODS
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 6. CONSTRAINTS METHODS AND ONCHANGE METHODS
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 7. CRUD METHODS
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 8. ACTION METHODS
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 9. BUSINESS METHODS
    # ------------------------------------------------------------------
