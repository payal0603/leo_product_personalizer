from odoo import fields, models


class SaleOrderLinePersonalization(models.Model):
    # ------------------------------------------------------------------
    # 1. PRIVATE ATTRIBUTES
    # ------------------------------------------------------------------

    _name = "sale.order.line.personalization"
    _description = "Personalized design saved against a sale order line"

    # ------------------------------------------------------------------
    # 2. DEFAULT METHODS AND default_get
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 3. FIELD DECLARATIONS
    # ------------------------------------------------------------------

    sale_order_line_id = fields.Many2one(
        'sale.order.line', string='Sale Order Line', required=True, ondelete='cascade', index=True
    )
    order_id = fields.Many2one(related='sale_order_line_id.order_id', store=True)
    design_type = fields.Char(string='Design Type', required=True,
        help='Identifier of the side/area (e.g. front, back)')
    design_config_id = fields.Many2one('product.design.config', string='Design Config')
    fabric_json = fields.Text('Fabric JSON')
    preview = fields.Binary('Preview Image', attachment=True)
    final_image = fields.Binary('Final Rendered Image', attachment=True)
    
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

    def get_image_url(self):
        """
        Return a web/image URL to this design_image.
        """
        self.ensure_one()
        if not self.design_image:
            return False
        fname = self.design_image_name or 'design_%s.png' % (self.id,)
        return '/web/image/product.design.config/%s/design_image/%s' % (self.id, fname)
