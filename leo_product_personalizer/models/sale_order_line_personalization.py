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
        "sale.order.line",
        string="Sale Order Line",
        required=True,
        ondelete="cascade",
        index=True,
    )
    order_id = fields.Many2one(related="sale_order_line_id.order_id", store=True)
    design_type = fields.Char(
        string="Design Type",
        required=True,
        help="Identifier of the side/area (e.g. front, back)",
    )
    design_title = fields.Char(string="Design Title")
    design_config_id = fields.Many2one(
        "product.design.config", string="Design Config"
    )
    personalized_json = fields.Text("Fabric JSON")
    product_image = fields.Image("Preview Image", store=True)

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
