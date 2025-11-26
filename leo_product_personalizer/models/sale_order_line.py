from odoo import fields, models


class SaleOrderLine(models.Model):
    # ------------------------------------------------------------------
    # 1. PRIVATE ATTRIBUTES
    # ------------------------------------------------------------------

    _inherit = "sale.order.line"

    # ------------------------------------------------------------------
    # 2. DEFAULT METHODS AND default_get
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 3. FIELD DECLARATIONS
    # ------------------------------------------------------------------

    personalization_ids = fields.One2many(
        "sale.order.line.personalization",
        "sale_order_line_id",
        string="Personalizations",
        help="Personalized designs saved against this sale order line.",
    )

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

    def action_view_personalizations(self):
        """
        Action to view personalizations related to this sale order line.
        """
        self.ensure_one()
        return {
            "name": "Personalizations",
            "type": "ir.actions.act_window",
            "res_model": "sale.order.line.personalization",
            "view_mode": "list,form",
            "domain": [("sale_order_line_id", "=", self.id)],
        }
