/** @odoo-module **/

import publicWidget from '@web/legacy/js/public/public_widget';
import { rpc } from '@web/core/network/rpc';

publicWidget.registry.CartPersonalizationButtons = publicWidget.Widget.extend({
    selector: '.o_cart_product',
    events: {
        'click .edit-design-btn': '_onClickEditDesign',
        'click .preview-design-btn': '_onClickPreviewDesign',
    },

    _onClickEditDesign: function (ev) {
        ev.preventDefault();
        const lineId = $(ev.currentTarget).data('line-id');
        window.location.href = `/shop/personalize/edit/${lineId}`;
    },

    _onClickPreviewDesign: function (ev) {
        ev.preventDefault();
        const lineId = $(ev.currentTarget).data('line-id');
        rpc('/shop/cart/preview_personalization', {
            line_id: parseInt(lineId)
        }).then((result) => {
            this._showPreviewModal(result);
        }).catch((error) => {
            console.error('Error loading preview:', error);
        });
    },

    _showPreviewModal: function (data) {
        const $grid = $('#preview_grid');
        const previews = data.previews || [];

        $grid.find('.design-title').each((index, el) => {
            if (previews[index] && previews[index].design_type) {
                $(el).text(previews[index].design_type);
            }
        });

        $grid.find('.preview-item img').each((index, el) => {
            if (previews[index] && previews[index].preview_url) {
                $(el).attr('src', previews[index].preview_url);
            }
        });

        $('#preview_personalization_modal').modal('show');
    },
});
