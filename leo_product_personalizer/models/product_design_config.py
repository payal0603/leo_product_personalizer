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

    product_tmpl_id = fields.Many2one(
        'product.template', string='Product Template', required=True, ondelete='cascade', index=True
    )

    design_type = fields.Char(string='Design Type', required=True, help="Identifier for the design side (e.g. front, back)")
    label = fields.Char(string='Label', help="Friendly label shown in selector")
    design_image = fields.Binary('Side Image', attachment=True)
    design_image_name = fields.Char('Image Filename')

    is_restricted_area = fields.Boolean('Has Restricted Area', help='When checked, user edits will be clamped inside the rectangle below.')
    bound_x = fields.Float('Bound X (px)')
    bound_y = fields.Float('Bound Y (px)')
    bound_width = fields.Float('Bound Width (px)')
    bound_height = fields.Float('Bound Height (px)')

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
